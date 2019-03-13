import 'knockout'
import { Position } from './position.js'
import { LiquidLong, Address, Position as ContractPosition } from '@keydonix/liquid-long-client-library'

// dev address
// const liquidLongContractAddress = Address.fromHexString('B03CF72BC5A9A344AAC43534D664917927367487')
// production address
const liquidLongContractAddress = Address.fromHexString('ADbE0dD80f0D75BEeD3247d659Ff7FE3bDACD8a1')

interface EthereumProvider {
	sendAsync?: (request: any, callback: (error: any, response: any) => void) => void
	selectedAddress?: string
}
declare global {
	interface Window {
		web3: { currentProvider: EthereumProvider }
		ethereum: EthereumProvider & { enable: () => Promise<void> }
	}
}

const getEthereumProvider = () => window.ethereum || (window.web3 && window.web3.currentProvider)
const isWeb3Enabled = () => !!getEthereumProvider()
const getSelectedAddress = () => {
	const provider = getEthereumProvider()
	if (!provider) return undefined
	const address = provider.selectedAddress
	if (!address) return undefined
	return Address.fromHexString(address)
}
const isLoggedIn = () => !!getSelectedAddress()
const supportsLogin = () => !!window.ethereum

export class Main {
	private liquidLong: LiquidLong
	private readonly currentPrice = ko.observable(0)
	public readonly positions = ko.observableArray<Position>()
	public readonly ethereumBrowser = ko.observable(isWeb3Enabled())
	public readonly loggedIn = ko.observable(isLoggedIn())
	public readonly loadingPositions = ko.observable(false)

	constructor() {
		this.liquidLong = this.loggedIn()
			? LiquidLong.createWeb3(getEthereumProvider(), liquidLongContractAddress, 1, 1000)
			: LiquidLong.createJsonRpc('https://eth-mainnet.alchemyapi.io/jsonrpc/7sE1TzCIRIQA3NJPD5wg7YRiVjhxuWAE', liquidLongContractAddress, 1, 1000)
		this.liquidLong.registerForEthPriceUpdated(x => this.currentPrice(x))
		this.populatePositions()
	}

	public readonly login = async () => {
		if (!supportsLogin()) return
		await window.ethereum.enable()
		this.loggedIn(true)
		// we don't want to keep hitting the public endpoint once we are connected through the browser ethereum interface, so shut the old one down
		await this.liquidLong.shutdown()
		this.liquidLong = LiquidLong.createWeb3(window.ethereum, liquidLongContractAddress, 1, 1000)
		this.populatePositions()
	}

	public readonly populatePositions = async () => {
		this.loadingPositions(true)
		try {
			const address = getSelectedAddress()
			if (!address) return
			// const address = Address.fromHexString('913dA4198E6bE1D5f5E4a40D0667f70C0B5430Eb')
			this.positions.removeAll()
			const contractPositions = await this.liquidLong.getPositions(address)
			this.positions.push(...contractPositions
				.filter(position => position.proxied)
				.filter(position => position.collateralInEth !== 0)
				.map(this.contractPositionToViewModel)
			)
		} finally {
			this.loadingPositions(false)
		}
	}

	private readonly contractPositionToViewModel = (cdp: ContractPosition): Position => {
		const id = cdp.id
		const ethOnDeposit = cdp.collateralInEth
		const debtInDai = cdp.debtInDai
		const ownerAddress = cdp.owner
		return new Position(this, this.liquidLong, id, ethOnDeposit, debtInDai, ownerAddress)
	}
}
