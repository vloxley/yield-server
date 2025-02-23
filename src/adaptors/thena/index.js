const utils = require('../utils')
const { request, gql } = require('graphql-request')

const API_URL = 'https://api.thena.fi/api/v1/pools'
const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/thenaursa/thena-v1'

const swapPairsQuery = (skip) => {
  return gql`
    query MyQuery {
      pairs(first: 100, skip: ${skip}, where: {reserveUSD_gt: 10000}) {
        reserve0
        reserve1
        token1 {
          id
          symbol
        }
        token0 {
          id
          symbol
        }
        reserveUSD
        id
      }
    }
  `
}

const getPairs = async () => {
  let pairs = []
  let index = 0
  let res
  do {
    res = await request(SUBGRAPH_URL, swapPairsQuery(index), {})
    if (res.pairs.length > 0) {
      pairs = [...pairs, ...res.pairs]
    }
    index += res.pairs.length
  } while (res.pairs.length > 0)
  return pairs
};

const getApy = async () => {
  // APR is retrieved using our api, tvl pairs etc trough subgraph
  const { data: poolsRes } = await utils.getData(API_URL)

  const apyDict = {}
  const alreadySeen = []

  for (const pool of poolsRes) {
    apyDict[pool.address.toLowerCase()] = pool.gauge.apr
  }

  const pairs = await getPairs()
  for (const pair of pairs) {
    const token0Key = 'bsc:' + pair.token0.id.toLowerCase()
    const token1Key = 'bsc:' + pair.token1.id.toLowerCase()

    if (!alreadySeen.includes(token0Key)) {
      alreadySeen.push(token0Key)
    }

    if (!alreadySeen.includes(token1Key)) {
      alreadySeen.push(token1Key)
    }
  }

  // asking price to defillama chunking requests (currently running with 1 request could be lowered if needed)
  let fullCoin = {}
  const chunkSize = 60
  for (let i = 0; i < alreadySeen.length; i += chunkSize) {
    const chunk = alreadySeen.slice(i, i + chunkSize)

    const { coins } = await utils.getData(`https://coins.llama.fi/prices/current/${chunk.join(',')}?searchWidth=4h`)
    fullCoin = { ...fullCoin, ...coins }
  }

  const pools = pairs.map((pair) => {
    let tvl = 0

    if (fullCoin['bsc:' + pair.token0.id.toLowerCase()] && fullCoin['bsc:' + pair.token1.id.toLowerCase()]) {
      const token0ValueInReserve = parseFloat(pair.reserve0) * parseFloat(fullCoin['bsc:' + pair.token0.id.toLowerCase()].price)
      const token1ValueInReserve = parseFloat(pair.reserve1) * parseFloat(fullCoin['bsc:' + pair.token1.id.toLowerCase()].price)

      tvl = token0ValueInReserve + token1ValueInReserve
    }
    else {
      // fallbacking to the one from api if defillama price are missing
      tvl = parseFloat(pair.reserveUSD)
    }

    return {
      pool: pair.id,
      chain: utils.formatChain('bsc'),
      project: 'thena',
      symbol: `${pair.token0.symbol}-${pair.token1.symbol}`,
      tvlUsd: tvl,
      apyReward: parseFloat(apyDict[pair.id.toLowerCase()]),
      underlyingTokens: [pair.token0.id, pair.token1.id],
      rewardTokens: [
        '0xF4C8E32EaDEC4BFe97E0F595AdD0f4450a863a11', // THE
      ],
    };
  })

  return pools;
};

module.exports = {
  timetravel: false,
  apy: getApy,
  url: 'https://thena.fi/liquidity',
};