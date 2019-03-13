import "knockout"

export const delay = async (milliseconds: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

export const asyncComputed = <T, TDefault>(defaultValue: TDefault, evaluator: () => Promise<T>): KnockoutObservable<T | TDefault> => {
	const observable = ko.observable<T | TDefault>(defaultValue)
	// nonces are used to track ordering to ensure that we never rollback the observable to a previous state due to racing promise resolution
	let triggeredNonce = 0
	let resolvedNonce = 0

	// function to run when something triggers an re-computing the result
	const processSubscription = async (promise: Promise<T>) => {
		try {
			const ourNonce = ++triggeredNonce
			const result = await promise
			// only update the observable if it hasn't already been updated by a call with newer dependencies
			if (ourNonce <= resolvedNonce) return
			resolvedNonce = ourNonce
			observable(result)
		} catch (error) {
			// CONSIDER: create a mechanism for propogating errors out of `asyncComputed`
			console.log(error)
		}
	}

	// have knockout watch the evaluator function for changes in dependent observables
	const watcher = ko.pureComputed(evaluator)
	// when the watcher notices a change, it will give us a new promise that we will await and apply to our observable
	watcher.subscribe(processSubscription)

	// evaluate and process once initially so we have the right value even if its dependencies never change thus subscription is never triggered
	const initialPromise = evaluator()
	processSubscription(initialPromise)

	return observable
}

export function toSignificantFigures(value: number, numberOfSignificantFigures: number, roundingFunction: (x: number) => number): number {
	// early return for 0
	if (value === 0) return 0
	// find the first significant digit
	for (let i = 0; i < 100; ++i) {
		const mostSignificantFigure = i - 50
		// this wasn't it, try the next one
		if (Math.floor(value * 10 ** mostSignificantFigure) === 0) continue
		// we found the most significant digit, return `numberOfSignificantFigures` more figures after that (inclusive)
		const leastSignificantFigure = mostSignificantFigure + numberOfSignificantFigures - 1
		// we round by getting the digit we care about into the 1s place, and then calling the rounding function, then adding an appropriate number of zeros back
		return roundingFunction(value * 10 ** leastSignificantFigure) / 10 ** leastSignificantFigure
	}
	// only reachable if the value is _really_ close to 0
	return 0
}

export function toDecimals(value: number, numberOfDecimals: number, roundingFunction: (x: number) => number): number {
	if (value === 0) return 0
	return roundingFunction(value * 10**numberOfDecimals) / 10**numberOfDecimals
}

/** convert a number to a color using hsl */
export function percentageToHue(percentage: number, hueStart: number, hueEnd: number) {
	return (percentage * (hueEnd - hueStart)) + hueStart
}

export function isMouseOverTarget(mouseEvent: MouseEvent, targetElement?: Element): boolean {
	if (targetElement === undefined) {
		targetElement = mouseEvent.currentTarget as Element
		if (!(targetElement instanceof Element)) return false
	}
	const boundingClientRect = targetElement.getBoundingClientRect()
	if (mouseEvent.clientX <= boundingClientRect.left) return false
	if (mouseEvent.clientX >= boundingClientRect.right) return false
	if (mouseEvent.clientY <= boundingClientRect.top) return false
	if (mouseEvent.clientY >= boundingClientRect.bottom) return false
	return true
}

export class EventTargetIterable {
	private eventTarget = null as Element | null
	constructor(eventTarget: EventTarget | null) {
		if (eventTarget instanceof Element) this.eventTarget = eventTarget as Element
	}
	[Symbol.iterator]() {
		let target: Element | null = this.eventTarget
		return {
			next: (): { done: boolean, value: Element } => {
				//@ts-ignore
				if (target === null) return { done: true }
				const result = { value: target, done: false }
				target = target.parentElement
				if (!(target instanceof Element)) target = null
				return result
			}
		}
	}
}
