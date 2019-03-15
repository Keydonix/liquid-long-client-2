import 'knockout'
import { LiquidLong, Address } from '@keydonix/liquid-long-client-library'
import { asyncComputed, isMouseOverTarget, percentageToHue, toDecimals, toSignificantFigures, EventTargetIterable } from '../utils/utils.js'
import { Main } from './main.js';

export class Position {
	public readonly slippageProtectionInEth = ko.observable(0)
	public readonly ethPriceInUsd = ko.observable<Promise<number>>(this.liquidLong.getEthPriceInUsd())
	constructor(
		public readonly main: Main,
		public readonly liquidLong: LiquidLong,
		public readonly id: number,
		public readonly collatoralInEth: number,
		public readonly debtInDai: number,
		public readonly ownerAddress: Address,
	) {
		this.liquidLong.registerForEthPriceUpdated((async newPrice => {
			if (newPrice === await this.ethPriceInUsd()) return
			this.ethPriceInUsd(Promise.resolve(newPrice))
		}))
		document.addEventListener('click', this.onClick)
	}


	// MODEL STUFF

	public readonly debtInEth = async (): Promise<number> => this.debtInDai / await this.ethPriceInUsd()
	public readonly collateralInUsd = async (): Promise<number> => this.collatoralInEth * await this.ethPriceInUsd()
	public readonly leverageSizeInEth = async (): Promise<number> => this.collatoralInEth - await this.debtInEth()
	public readonly leverageMultiplier = async (): Promise<number> => this.collatoralInEth / await this.leverageSizeInEth()
	public readonly serviceFeeInEth = async (): Promise<number> => {
		const leverageMultiplier = await this.leverageMultiplier()
		const leverageSizeInEth = await this.leverageSizeInEth()
		return await this.liquidLong.getFeeInEth(leverageMultiplier, leverageSizeInEth)
	}
	public readonly expectedYieldInEth = async (): Promise<number | null> => {
		const estimatedYieldInEth = await this.liquidLong.tryGetEstimatedCloseYieldInEth(this.ownerAddress, this.id)
		if (estimatedYieldInEth === null) return null
		const fudgeForFeesOverTimeInDai = this.debtInDai * 0.0001
		const fudgeForFeesOverTimeInEth = fudgeForFeesOverTimeInDai / await this.ethPriceInUsd()
		return estimatedYieldInEth - this.slippageProtectionInEth() - fudgeForFeesOverTimeInEth
	}
	// FIXME: lies, these are `USD - DAI` which are incompatible units so this is not actually USD
	public readonly currentValueInUsd = async (): Promise<number> => {
		const ethPriceInUsd = await this.ethPriceInUsd()
		return await this.valueAtPrice(ethPriceInUsd)
	}
	public readonly doublePriceInUsd = async (): Promise<number> => {
		const leverageMultiplier = await this.leverageMultiplier()
		return await this.liquidLong.getFuturePriceInUsdForPercentChange(1, leverageMultiplier)
	}
	public readonly doubleValueInUsd = async (): Promise<number> => {
		const doublePriceInUsd = await this.doublePriceInUsd()
		return await this.valueAtPrice(doublePriceInUsd)
	}
	public readonly liquidationPriceInUsd = async (): Promise<number> => {
		const leverageMultiplier = await this.leverageMultiplier()
		return await this.liquidLong.getLiquidationPriceInUsd(leverageMultiplier)
	}
	public readonly liquidationValueInUsd = async (): Promise<number> => {
		const liquidationPriceInUsd = await this.liquidationPriceInUsd()
		return await this.valueAtPrice(liquidationPriceInUsd)
	}
	public readonly liquidationLossPercentage = async (): Promise<number> => {
		const leverageMultiplier = await this.leverageMultiplier()
		return await this.liquidLong.getLiquidationPenaltyPercent(leverageMultiplier)
	}
	public readonly maxLossPercentage = async (): Promise<number> => {
		const liquidationPriceInUsd = await this.liquidationPriceInUsd()
		const leverageMultiplier = await this.leverageMultiplier()
		return await this.liquidLong.getPercentageChangeForFuturePrice(liquidationPriceInUsd, leverageMultiplier)
	}
	public readonly currentPercentageBetweenLiquidationAndDouble = async (): Promise<number> => {
		const ethPriceInUsd = await this.ethPriceInUsd()
		const liquidationPriceInUsd = await this.liquidationPriceInUsd()
		const doublePriceInUsd = await this.doublePriceInUsd()
		return (ethPriceInUsd - liquidationPriceInUsd) / (doublePriceInUsd - liquidationPriceInUsd)
	}
	public readonly valueAtPrice = async (price: number): Promise<number> => {
		const leverageMultiplier = await this.leverageMultiplier()
		const leverageSizeInEth = await this.leverageSizeInEth()
		return await this.liquidLong.getPositionValueInUsdAtFuturePrice(price, leverageMultiplier, leverageSizeInEth)
	}


	// VIEW STUFF

	public readonly awaitingCloseConfirmation = ko.observable(false)
	public readonly closeButtonVisibility = asyncComputed(false, async () => !this.awaitingCloseConfirmation() && await this.expectedYieldInEth() !== null)
	public readonly closingSpinnerVisibility = asyncComputed(true, async () => this.awaitingCloseConfirmation() || await this.expectedYieldInEth() === null)
	public readonly closeClicked = async () => {
		try {
			this.awaitingCloseConfirmation(true)
			const expectedEthYield = await this.expectedYieldInEth()
			if (expectedEthYield === null) throw new Error(`Not enough available liquidity to close this position.`)
			await this.liquidLong.closePosition(this.ownerAddress, this.id, expectedEthYield)
			this.main.populatePositions()
		} finally {
			this.awaitingCloseConfirmation(false)
		}
	}

	public readonly expanded = ko.observable(false)
	public readonly collapsed = ko.pureComputed(() => !this.expanded())
	public readonly collapse = () => this.expanded(false)
	public readonly expand = () => this.expanded(true)

	public readonly hoverPercentageBetweenLiquidationAndDouble = ko.observable<number | null>(null)
	public readonly mouseIsOverChart = ko.pureComputed(() => this.hoverPercentageBetweenLiquidationAndDouble() !== null)
	public readonly chartMouseOut = (_: Position, mouseEvent: MouseEvent): boolean => {
		if (isMouseOverTarget(mouseEvent)) return false
		this.hoverPercentageBetweenLiquidationAndDouble(null)
		return true
	}
	public readonly chartMouseMove = async (_: Position, mouseEvent: MouseEvent) => {
		if (this.chartMouseOut(_, mouseEvent)) return
		this.hoverPercentageBetweenLiquidationAndDouble(null)

		const chartElement = mouseEvent.currentTarget
		if (!(chartElement instanceof HTMLElement)) return

		const gradientClientY = chartElement.getBoundingClientRect().bottom
		const gradientPageY = gradientClientY + window.scrollY
		const mouseRelativeToChartY = gradientPageY - mouseEvent.pageY
		const chartHeight = chartElement.getBoundingClientRect().height
		const hoverPercentageOfChart = mouseRelativeToChartY / chartHeight
		this.hoverPercentageBetweenLiquidationAndDouble(hoverPercentageOfChart)
	}

	public readonly explainerHtml = ko.observable<string | null>(null)
	public readonly explainerVisibility = ko.pureComputed(() => this.explainerHtml() !== null)
	public readonly onClick = (mouseEvent: MouseEvent): void => {
		const targetWalker = new EventTargetIterable(mouseEvent.target)
		for (let element of targetWalker) {
			if (element.classList.contains('explainer')) return
			if (ko.dataFor(element) !== this) continue
			const explainerHtml = element.getAttribute('data-tooltip')
			if (!explainerHtml) continue
			this.explainerHtml(explainerHtml)
			return
		}
		this.explainerHtml(null)
	}

	public readonly liquidationPriceText = asyncComputed('', async () => {
		const liquidationPriceInUsd = await this.liquidationPriceInUsd()
		const humanized = toDecimals(liquidationPriceInUsd, 2, Math.ceil).toFixed(2)
		return `$${humanized}`
	})

	public readonly leverageMultiplierText = asyncComputed('', async () => {
		const leverageMultiplier = await this.leverageMultiplier()
		const humanized = toSignificantFigures(leverageMultiplier, 3, Math.round)
		return `${humanized}x`
	})

	public readonly leverageMultiplierColor = asyncComputed('black', async () => {
		const leverageMultiplier = await this.leverageMultiplier()
		if (leverageMultiplier === null) return `hsl(0, 0%, 0%)`
		const percentage = Math.min(1, Math.max(0, (leverageMultiplier - 1) / 2))
		const red = (percentage > 0.5) ? 255 : 255 * percentage * 2
		const green = 255 * (1 - percentage)
		const hue = percentageToHue(percentage, 120, 0)
		return `hsl(${hue}, 100%, 40%)`
		return `rgb(${red}, ${green}, 0)`
	})

	public readonly leverageSizeText = asyncComputed('', async () => {
		const leverageSizeInEth = await this.leverageSizeInEth()
		if (leverageSizeInEth === null) return ''
		const humanized = toSignificantFigures(leverageSizeInEth, 4, Math.floor)
		return `${humanized}Ξ`
	})

	public readonly serviceFeeText = asyncComputed('', async () => {
		const serviceFeeInEth = await this.serviceFeeInEth()
		if (serviceFeeInEth === null) return ''
		const humanized = toSignificantFigures(serviceFeeInEth, 2, Math.ceil)
		return `${humanized}Ξ`
	})

	public readonly slippageProtectionText = ko.pureComputed(() => {
		return `${this.slippageProtectionInEth()}Ξ`
	})

	public readonly expectedYieldText = asyncComputed('', async () => {
		const expectedYieldInEth = await this.expectedYieldInEth()
		if (expectedYieldInEth === null) return ''
		const humanized = toSignificantFigures(expectedYieldInEth, 4, Math.floor)
		return `${humanized}Ξ`
	})

	public readonly currentValueText = asyncComputed('', async () => {
		const portfolioValueInUsd = await this.currentValueInUsd()
		const humanized = toDecimals(portfolioValueInUsd, 2, Math.floor).toFixed(2)
		return `$${humanized}`
	})

	public readonly currentPriceText = asyncComputed('', async () => {
		const ethPriceInUsd = await this.ethPriceInUsd()
		const humanized = toDecimals(ethPriceInUsd, 2, Math.floor).toFixed(2)
		return `$${humanized}`
	})

	public readonly liquidationValueText = asyncComputed('', async () => {
		const liquidationPriceInUsd = await this.liquidationPriceInUsd()
		const collateralInUsd = this.collatoralInEth * liquidationPriceInUsd
		const debtInDai = this.debtInDai
		const positionValueInUsd = collateralInUsd - debtInDai
		const humanized = toDecimals(positionValueInUsd, 2, Math.floor).toFixed(2)
		return `$${humanized}`
	})

	public readonly maxLossText = asyncComputed('', async () => {
		const maxLossPercentage = await this.maxLossPercentage()
		const humanized = Math.ceil(maxLossPercentage * -100)
		return `${humanized}%`
	})

	public readonly liquidationLossText = asyncComputed('', async () => {
		const liquidationLossPercentage = await this.liquidationLossPercentage()
		const humanized = Math.ceil(liquidationLossPercentage * -100)
		return `${humanized}%`
	})

	public readonly doublePriceText = asyncComputed('', async () => {
		const doublePriceInUsd = await this.doublePriceInUsd()
		const humanized = toDecimals(doublePriceInUsd, 2, Math.ceil).toFixed(2)
		return `$${humanized}`
	})

	public readonly doublePriceLineVisibility = asyncComputed(false, async () => {
		// we need to teach knockout about our dependencies because it can't track theme across async boundaries
		this.mouseIsOverChart()
		this.hoverPercentageBetweenLiquidationAndDouble()
		this.ethPriceInUsd()
		const currentPercentageBetweenLiquidationAndDouble = await this.currentPercentageBetweenLiquidationAndDouble()
		const hoverPercentageBetweenLiquidationAndDouble = this.hoverPercentageBetweenLiquidationAndDouble()
		if (hoverPercentageBetweenLiquidationAndDouble === null) return true
		const mouseIsOverChart = this.mouseIsOverChart()
		return currentPercentageBetweenLiquidationAndDouble < 0.90 && (hoverPercentageBetweenLiquidationAndDouble < 0.90 || !mouseIsOverChart)
	})

	public readonly currentPriceLineStyleBottom = asyncComputed('0%', async () => {
		const currentPercentageBetweenLiquidationAndDouble = await this.currentPercentageBetweenLiquidationAndDouble()
		return `${currentPercentageBetweenLiquidationAndDouble * 100}%`
	})

	public readonly currentPriceLineVisibility = asyncComputed(false, async () => {
		// we need to teach knockout about our dependencies because it can't track theme across async boundaries
		this.mouseIsOverChart()
		this.hoverPercentageBetweenLiquidationAndDouble()
		this.ethPriceInUsd()
		const currentPercentageBetweenLiquidationAndDouble = await this.currentPercentageBetweenLiquidationAndDouble()
		const hoverPercentageBetweenLiquidationAndDouble = this.hoverPercentageBetweenLiquidationAndDouble()
		if (hoverPercentageBetweenLiquidationAndDouble === null) return true
		const mouseIsOverChart = this.mouseIsOverChart()
		const isHoverSufficientlyAboveCurrent = (hoverPercentageBetweenLiquidationAndDouble - currentPercentageBetweenLiquidationAndDouble) > 0.05
		const isHoverSufficientlyBelowCurrent = (currentPercentageBetweenLiquidationAndDouble - hoverPercentageBetweenLiquidationAndDouble) > 0.05
		return isHoverSufficientlyBelowCurrent || isHoverSufficientlyAboveCurrent || !mouseIsOverChart
	})

	public readonly liquidationPriceLineVisibility = asyncComputed(false, async () => {
		// we need to teach knockout about our dependencies because it can't track theme across async boundaries
		this.mouseIsOverChart()
		this.hoverPercentageBetweenLiquidationAndDouble()
		this.ethPriceInUsd()
		const currentPercentageBetweenLiquidationAndDouble = await this.currentPercentageBetweenLiquidationAndDouble()
		const hoverPercentageBetweenLiquidationAndDouble = this.hoverPercentageBetweenLiquidationAndDouble()
		if (hoverPercentageBetweenLiquidationAndDouble === null) return currentPercentageBetweenLiquidationAndDouble > 0.05
		const mouseIsOverChart = this.mouseIsOverChart()
		return (currentPercentageBetweenLiquidationAndDouble > 0.05) && (hoverPercentageBetweenLiquidationAndDouble > 0.05 || !mouseIsOverChart)
	})

	public readonly hoverLinePrice = asyncComputed(null, async () => {
		// we need to teach knockout about our dependencies because it can't track theme across async boundaries
		this.ethPriceInUsd()
		this.hoverPercentageBetweenLiquidationAndDouble()
		const liquidationPriceInUsd = await this.liquidationPriceInUsd()
		const doublePriceInUsd = await this.doublePriceInUsd()
		const hoverPercentageOfChart = await this.hoverPercentageBetweenLiquidationAndDouble()
		if (hoverPercentageOfChart === null) return null
		return hoverPercentageOfChart * (doublePriceInUsd - liquidationPriceInUsd) + liquidationPriceInUsd
	})

	public readonly hoverPriceText = ko.pureComputed(() => {
		const hoverLinePriceInUsd = this.hoverLinePrice()
		if (hoverLinePriceInUsd === null) return ''
		const humanized = toDecimals(hoverLinePriceInUsd, 2, Math.round).toFixed(2)
		return `$${humanized}`
	})

	public readonly hoverValueText = ko.computed(() => {
		const hoverLinePriceInUsd = this.hoverLinePrice()
		if (hoverLinePriceInUsd === null) return ''
		const collateralInUsd = this.collatoralInEth * hoverLinePriceInUsd
		if (collateralInUsd === null) return null
		const debtInDai = this.debtInDai
		const positionValueInUsd = collateralInUsd - debtInDai
		const humanized = toDecimals(positionValueInUsd, 2, Math.floor).toFixed(2)
		return `Value: $${humanized}`
	})

	public readonly hoverPriceLineStyleBottom = ko.pureComputed(() => {
		const hoverLineBottomOffset = this.hoverPercentageBetweenLiquidationAndDouble()
		if (hoverLineBottomOffset === null) return '0%'
		return `${hoverLineBottomOffset * 100}%`
	})

	public readonly hoverPriceLineVisibility = ko.pureComputed(() => {
		return this.mouseIsOverChart()
	})
}
