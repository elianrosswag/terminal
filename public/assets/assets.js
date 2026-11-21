// KRAFT Terminal — asset universe.
// type 'stock' → US ticker (CNBC / Nasdaq). type 'crypto' → CoinGecko id (cg) for prices, Revolut X pair for candles.
// tv = TradingView symbol. grp = group used for filters and the heatmap.
// Descriptions describe the business model; figures that go stale quickly
// (holdings, hashrate, AUM) are left out on purpose.
window.KRAFT_GROUPS = [
  'Crypto', 'Exchanges & brokers', 'Stablecoins', 'BTC treasury', 'Bitcoin miners',
  'Miners → AI/HPC', 'Bitcoin ETFs', 'AI', 'Custom',
];

window.KRAFT_ASSETS = [
  // CRYPTO
  { sym: 'BTC', cg: 'bitcoin', pair: 'BTC-USD', tv: 'BINANCE:BTCUSDT', type: 'crypto', grp: 'Crypto', cat: 'L1 / store of value', name: 'Bitcoin',
    desc: 'Fixed 21 million supply, proof-of-work. The reference asset for everything else on this sheet: miners, treasuries and ETFs all trade as BTC proxies.' },
  { sym: 'ETH', cg: 'ethereum', pair: 'ETH-USD', tv: 'BINANCE:ETHUSDT', type: 'crypto', grp: 'Crypto', cat: 'L1 / smart contracts', name: 'Ethereum',
    desc: 'The main settlement layer for stablecoins, tokenised assets and DeFi. Proof-of-stake; ETH is used to pay for blockspace.' },
  { sym: 'HYPE', cg: 'hyperliquid', pair: 'HYPE-USD', tv: 'BYBIT:HYPEUSDT', type: 'crypto', grp: 'Crypto', cat: 'DeFi / perps DEX', name: 'Hyperliquid',
    desc: 'Token of Hyperliquid, the largest on-chain perpetual futures exchange, running on its own L1. Exchange revenue funds token buybacks.' },

  // EXCHANGES & BROKERS
  { sym: 'COIN', tv: 'NASDAQ:COIN', type: 'stock', grp: 'Exchanges & brokers', cat: 'Exchange', name: 'Coinbase Global',
    desc: 'Largest regulated US crypto exchange. Revenue tracks trading volume and volatility, plus custody, staking, and its share of USDC reserve income.' },
  { sym: 'HOOD', tv: 'NASDAQ:HOOD', type: 'stock', grp: 'Exchanges & brokers', cat: 'Brokerage', name: 'Robinhood Markets',
    desc: 'Retail brokerage where crypto trading is a large and volatile share of transaction revenue. Expanding into tokenised stocks and prediction markets.' },

  // STABLECOINS
  { sym: 'CRCL', tv: 'NYSE:CRCL', type: 'stock', grp: 'Stablecoins', cat: 'Stablecoin issuer', name: 'Circle Internet Group',
    desc: 'Issuer of USDC. Earns the yield on the T-bills and cash backing it, so revenue moves with USDC supply and short-term US rates. Listed 2025.' },

  // BTC TREASURY
  { sym: 'MSTR', tv: 'NASDAQ:MSTR', type: 'stock', grp: 'BTC treasury', cat: 'BTC treasury', name: 'Strategy',
    desc: 'Largest corporate bitcoin holder. Raises equity, converts and preferreds to buy BTC, so the stock behaves like leveraged bitcoin with a premium or discount to its holdings.' },
  { sym: 'SMLR', tv: 'NASDAQ:SMLR', type: 'stock', grp: 'BTC treasury', cat: 'BTC treasury', name: 'Semler Scientific',
    desc: 'Medical-device company that adopted a bitcoin treasury strategy in 2024. Check the Data tab if it shows no price: corporate actions can change or retire a ticker.' },

  // BITCOIN MINERS
  { sym: 'MARA', tv: 'NASDAQ:MARA', type: 'stock', grp: 'Bitcoin miners', cat: 'BTC mining', name: 'MARA Holdings',
    desc: 'Largest US-listed bitcoin miner by hashrate. Keeps a large self-mined BTC stack, so it carries both operating and treasury exposure.' },
  { sym: 'RIOT', tv: 'NASDAQ:RIOT', type: 'stock', grp: 'Bitcoin miners', cat: 'BTC mining', name: 'Riot Platforms',
    desc: 'Texas miner with large owned power capacity. Earns power-curtailment credits from ERCOT and is weighing AI/HPC use of its sites.' },
  { sym: 'CLSK', tv: 'NASDAQ:CLSK', type: 'stock', grp: 'Bitcoin miners', cat: 'BTC mining', name: 'CleanSpark',
    desc: 'US miner focused on low-cost power in the American South, grown largely through site acquisitions.' },
  { sym: 'CIFR', tv: 'NASDAQ:CIFR', type: 'stock', grp: 'Bitcoin miners', cat: 'BTC mining', name: 'Cipher Mining',
    desc: 'Texas-based miner on long-term power contracts, now also leasing capacity for HPC. Smaller cap, higher beta than the large miners.' },
  { sym: 'BITF', tv: 'NASDAQ:BITF', type: 'stock', grp: 'Bitcoin miners', cat: 'BTC mining', name: 'Bitfarms',
    desc: 'Miner with sites across the Americas, historically hydro-powered, shifting part of its footprint toward HPC.' },

  // MINERS → AI/HPC
  { sym: 'CORZ', tv: 'NASDAQ:CORZ', type: 'stock', grp: 'Miners → AI/HPC', cat: 'Mining / HPC', name: 'Core Scientific',
    desc: 'Former pure miner turned large AI data-centre host, with major hosting contracts for CoreWeave alongside its remaining mining.' },
  { sym: 'IREN', tv: 'NASDAQ:IREN', type: 'stock', grp: 'Miners → AI/HPC', cat: 'Mining / HPC', name: 'IREN',
    desc: 'Renewable-powered bitcoin miner that also runs its own GPU cloud for AI workloads. Formerly Iris Energy.' },
  { sym: 'WULF', tv: 'NASDAQ:WULF', type: 'stock', grp: 'Miners → AI/HPC', cat: 'Mining / HPC', name: 'TeraWulf',
    desc: 'Miner powered largely by zero-carbon energy in New York and Pennsylvania, building out HPC hosting capacity for AI tenants.' },
  { sym: 'HUT', tv: 'NASDAQ:HUT', type: 'stock', grp: 'Miners → AI/HPC', cat: 'Mining / HPC', name: 'Hut 8',
    desc: 'Energy and data-centre developer with bitcoin mining (largely through American Bitcoin) and AI/HPC infrastructure projects.' },
  { sym: 'HIVE', tv: 'NASDAQ:HIVE', type: 'stock', grp: 'Miners → AI/HPC', cat: 'Mining / HPC', name: 'HIVE Digital',
    desc: 'Green-energy miner across Canada, Sweden and Paraguay that also rents GPU compute for AI through HIVE Cloud.' },
  { sym: 'BTBT', tv: 'NASDAQ:BTBT', type: 'stock', grp: 'Miners → AI/HPC', cat: 'Mining / HPC', name: 'Bit Digital',
    desc: 'Moved away from mining toward ETH treasury and AI infrastructure, including its stake in the WhiteFiber data-centre business.' },

  // BITCOIN ETFs
  { sym: 'IBIT', tv: 'NASDAQ:IBIT', type: 'stock', grp: 'Bitcoin ETFs', cat: 'Spot BTC ETF', name: 'iShares Bitcoin Trust',
    desc: "BlackRock's spot bitcoin ETF and the largest by assets. The main institutional on-ramp to BTC." },
  { sym: 'FBTC', tv: 'CBOE:FBTC', type: 'stock', grp: 'Bitcoin ETFs', cat: 'Spot BTC ETF', name: 'Fidelity Wise Origin Bitcoin',
    desc: 'Fidelity spot bitcoin ETF. Unusually, Fidelity custodies the coins itself.' },
  { sym: 'GBTC', tv: 'AMEX:GBTC', type: 'stock', grp: 'Bitcoin ETFs', cat: 'Spot BTC ETF', name: 'Grayscale Bitcoin Trust',
    desc: 'The original 2013 bitcoin trust, converted to a spot ETF in January 2024. Highest fee in the group, which has driven steady outflows.' },
  { sym: 'ARKB', tv: 'CBOE:ARKB', type: 'stock', grp: 'Bitcoin ETFs', cat: 'Spot BTC ETF', name: 'ARK 21Shares Bitcoin',
    desc: 'Spot bitcoin ETF from ARK Invest and 21Shares.' },
  { sym: 'BITO', tv: 'AMEX:BITO', type: 'stock', grp: 'Bitcoin ETFs', cat: 'BTC futures ETF', name: 'ProShares Bitcoin Strategy',
    desc: 'First US bitcoin ETF (2021). Holds CME futures, not coins, so roll costs make it lag spot over time.' },

  // AI
  { sym: 'NVDA', tv: 'NASDAQ:NVDA', type: 'stock', grp: 'AI', cat: 'AI chips', name: 'NVIDIA',
    desc: 'Dominant supplier of AI training and inference GPUs plus the networking and software around them. The bellwether for AI capex.' },
  { sym: 'AMD', tv: 'NASDAQ:AMD', type: 'stock', grp: 'AI', cat: 'AI chips', name: 'Advanced Micro Devices',
    desc: 'CPUs and the Instinct line of data-centre GPUs, the main merchant alternative to NVIDIA for AI accelerators.' },
  { sym: 'AVGO', tv: 'NASDAQ:AVGO', type: 'stock', grp: 'AI', cat: 'AI chips / networking', name: 'Broadcom',
    desc: 'Custom AI accelerators (ASICs) for hyperscalers and the Ethernet switching silicon that connects AI clusters.' },
  { sym: 'TSM', tv: 'NYSE:TSM', type: 'stock', grp: 'AI', cat: 'Foundry', name: 'Taiwan Semiconductor',
    desc: 'Manufactures nearly every leading AI chip, including advanced packaging. US-listed ADR.' },
  { sym: 'PLTR', tv: 'NASDAQ:PLTR', type: 'stock', grp: 'AI', cat: 'AI software', name: 'Palantir',
    desc: 'Data and AI platforms for government and enterprise. Trades at a high multiple, so it swings hard on sentiment.' },
  { sym: 'CRWV', tv: 'NASDAQ:CRWV', type: 'stock', grp: 'AI', cat: 'AI cloud', name: 'CoreWeave',
    desc: 'GPU cloud built for AI labs and hyperscalers, financed heavily with debt. Its hosting deals tie it closely to the converted bitcoin miners.' },
  { sym: 'NBIS', tv: 'NASDAQ:NBIS', type: 'stock', grp: 'AI', cat: 'AI cloud', name: 'Nebius Group',
    desc: 'Amsterdam-based AI cloud provider building GPU data centres in Europe and the US.' },
];
