/* global artifacts:false, it:false, contract:false, assert:false */

const WyvernAtomicizer = artifacts.require('WyvernAtomicizer')
const WyvernExchange = artifacts.require('WyvernExchange')
const WyvernStatic = artifacts.require('WyvernStatic')
const StaticMarket = artifacts.require('StaticMarket')
const WyvernRegistry = artifacts.require('WyvernRegistry')
const TestERC20 = artifacts.require('TestERC20')
const TestERC721 = artifacts.require('TestERC721')

const Web3 = require('web3')
const provider = new Web3.providers.HttpProvider('http://localhost:8545')
const web3 = new Web3(provider)

const BigNumber = require('bignumber.js');

const {wrap,ZERO_BYTES32,CHAIN_ID,assertIsRejected} = require('./util')

contract('WyvernExchange', (accounts) => {
	let deploy_core_contracts = async () =>
		{
		let [registry,atomicizer] = await Promise.all([WyvernRegistry.new(), WyvernAtomicizer.new()])
		let [exchange,staticMarket,wyvernStatic] = await Promise.all([WyvernExchange.new(CHAIN_ID,[registry.address],'0x'), StaticMarket.new(), WyvernStatic.new(atomicizer.address)])
		await registry.grantInitialAuthentication(exchange.address)
		return {registry,exchange:wrap(exchange),atomicizer,staticMarket,wyvernStatic}
		}

	let deploy = async contracts => Promise.all(contracts.map(contract => contract.new()))

	it('NFT: swap erc721 with eth', async () => {
		let {exchange, registry, staticMarket, wyvernStatic} = await deploy_core_contracts()
		let [erc721] = await deploy([TestERC721])

		const account_a = accounts[0]
		const account_b = accounts[6]
		const tokenId = 10
		const price = 1000 // eth

		await registry.registerProxy({from: account_a})
		let proxy1 = await registry.proxies(account_a)
		assert.equal(true, proxy1.length > 0, 'no proxy address for account a')

		await registry.registerProxy({from: account_b})
		let proxy2 = await registry.proxies(account_b)
		assert.equal(true, proxy2.length > 0, 'no proxy address for account b')
		
		await Promise.all([erc721.setApprovalForAll(proxy1,true,{from: account_a})])
		await Promise.all([erc721.mint(account_a,tokenId)])

		const erc721c = new web3.eth.Contract(erc721.abi, erc721.address)
		const selectorOne = web3.eth.abi.encodeFunctionSignature('anyAddOne(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
		const selectorTwo = web3.eth.abi.encodeFunctionSignature('anyAddOne(bytes,address[7],uint8[2],uint256[6],bytes,bytes)')
			
		const paramsOne = '0x'
		const paramsTwo = '0x'

		const one = {registry: registry.address, maker: account_a, staticTarget: wyvernStatic.address, staticSelector: selectorOne, staticExtradata: paramsOne, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '11'}
		const two = {registry: registry.address, maker: account_b, staticTarget: wyvernStatic.address, staticSelector: selectorTwo, staticExtradata: paramsTwo, maximumFill: 1, listingTime: '0', expirationTime: '10000000000', salt: '12'}

		const firstData = erc721c.methods.transferFrom(account_a, account_b, tokenId).encodeABI()
		const wyvernStaticc = new web3.eth.Contract(wyvernStatic.abi, wyvernStatic.address)
		const secondData = wyvernStaticc.methods.test().encodeABI()
		
		const firstCall = {target: erc721.address, howToCall: 0, data: firstData}
		const secondCall = {target: wyvernStatic.address, howToCall: 0, data: secondData}

		let [initBalanceA, initBalanceB] = await Promise.all([web3.eth.getBalance(account_a), web3.eth.getBalance(account_b)])

		let sigOne = await exchange.sign(one, account_a)
		let sigTwo = await exchange.sign(two, account_b)
		await exchange.atomicMatchWith(one, sigOne, firstCall, two, sigTwo, secondCall, ZERO_BYTES32, {from: account_b, value: price})
		
		let [token_owner] = await Promise.all([erc721.ownerOf(tokenId)])
		assert.equal(token_owner, account_b,'Incorrect token owner')

		let [balanceA, balanceB] = await Promise.all([web3.eth.getBalance(account_a), web3.eth.getBalance(account_b)])
		console.log(`balances: ${account_a}:${balanceA}, ${account_b}:${balanceB}`);

		assert.equal(balanceA, (new BigNumber(initBalanceA).plus(price)).toFixed())
		// account_b need pay some gas in ETH
		assert.isTrue((new BigNumber(balanceB)).isLessThan(new BigNumber(initBalanceB).minus(price)));
	})

})
