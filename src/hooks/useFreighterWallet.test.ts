import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const { mockIsConnected, mockRequestAccess, mockGetAddress, mockGetNetwork } = vi.hoisted(() => ({
  mockIsConnected: vi.fn(),
  mockRequestAccess: vi.fn(),
  mockGetAddress: vi.fn(),
  mockGetNetwork: vi.fn(),
}))

vi.mock('@stellar/freighter-api', () => ({
  isConnected: (...args: any[]) => mockIsConnected(...args),
  requestAccess: (...args: any[]) => mockRequestAccess(...args),
  getAddress: (...args: any[]) => mockGetAddress(...args),
  getNetwork: (...args: any[]) => mockGetNetwork(...args),
}))

const { mockLoadAccount, mockOperationsCall } = vi.hoisted(() => ({
  mockLoadAccount: vi.fn(),
  mockOperationsCall: vi.fn(),
}))

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const orig: any = await importOriginal()
  class MockHorizonServer {
    loadAccount = mockLoadAccount
    operations() {
      return {
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: mockOperationsCall,
            }),
          }),
        }),
      }
    }
  }
  return {
    ...orig,
    Horizon: { Server: MockHorizonServer },
  }
})

import { useFreighterWallet } from './useFreighterWallet'

const TEST_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'

describe('useFreighterWallet — wallet payment readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockResolvedValue({ isConnected: false })
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '100.0000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '5.0000000' },
      ],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })
  })

  it('initial state is disconnected', () => {
    const { result } = renderHook(() => useFreighterWallet())
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.wallet.publicKey).toBeNull()
    expect(result.current.wallet.xlmBalance).toBe('0')
    expect(result.current.wallet.usdcBalance).toBe('0')
    expect(result.current.transactions).toEqual([])
  })

  it('connect throws if Freighter not installed', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: false })
    // need to make isConnected false so connect throws
    // but our hook checks isConnected().isConnected
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.wallet.error).toMatch(/Freighter extension not found/)
  })

  it('connect succeeds and fetches balances', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS, error: undefined })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET', error: undefined })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '42.1234' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '1.5000000' },
      ],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })

    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    expect(result.current.wallet.publicKey).toBe(TEST_ADDRESS)
    expect(result.current.wallet.network).toBe('TESTNET')
    // balances fetched via Horizon mock
    expect(mockLoadAccount).toHaveBeenCalledWith(TEST_ADDRESS)
    // wait for async balance update
    await waitFor(() => expect(result.current.wallet.xlmBalance).toBe('42.1234'))
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('1.500000'))
  })

  it('disconnect resets wallet state', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    act(() => {
      result.current.disconnect()
    })
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.wallet.publicKey).toBeNull()
    expect(result.current.transactions).toEqual([])
  })

  it('refresh fetches balances and transactions when connected', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000' }],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    mockLoadAccount.mockClear()
    mockOperationsCall.mockClear()
    await act(async () => {
      await result.current.refresh()
    })
    expect(mockLoadAccount).toHaveBeenCalled()
    expect(mockOperationsCall).toHaveBeenCalled()
  })

  it('fetchBalances formats XLM to 4 decimals and USDC to 6', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '99.99999' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '0.123456789' },
      ],
    })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('0.123457')) // rounded to 6
    expect(result.current.wallet.xlmBalance).toBe('100.0000') // 99.99999 -> 100.0000 after toFixed(4)
  })

  it('handles Horizon payment operations mapping', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({ balances: [{ asset_type: 'native', balance: '0' }] })
    mockOperationsCall.mockResolvedValue({
      records: [
        {
          type: 'payment',
          id: '1',
          transaction_hash: 'abc123',
          amount: '0.001',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          from: 'GAAA',
          to: TEST_ADDRESS,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          type: 'create_account',
          id: '2',
          transaction_hash: 'def456',
          funder: 'GAAA',
          account: TEST_ADDRESS,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          type: 'manage_offer', // should be filtered out
          id: '3',
          transaction_hash: 'ghi789',
        },
      ],
    })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.transactions.length).toBe(2))
    expect(result.current.transactions[0].hash).toBe('abc123')
    expect(result.current.transactions[0].asset).toBe('USDC')
    expect(result.current.transactions[1].type).toBe('create_account')
  })
})

describe('useFreighterWallet — independent balance/history/connection tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsConnected.mockResolvedValue({ isConnected: false })
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: 'native', balance: '100.0000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '5.0000000' },
      ],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })
  })

  it('each resource exposes loading/error/lastUpdated independently after connect', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '1.0000000' }],
    })
    mockOperationsCall.mockResolvedValue({ records: [{ type: 'payment', id: '1', transaction_hash: 'h1', amount: '0.001', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-01-01T00:00:00Z' }] })

    const { result } = renderHook(() => useFreighterWallet())

    // Initially all null/false
    expect(result.current.connection.loading).toBe(false)
    expect(result.current.connection.error).toBeNull()
    expect(result.current.connection.lastUpdated).toBeNull()
    expect(result.current.balance.loading).toBe(false)
    expect(result.current.balance.error).toBeNull()
    expect(result.current.balance.lastUpdated).toBeNull()
    expect(result.current.history.loading).toBe(false)
    expect(result.current.history.error).toBeNull()
    expect(result.current.history.lastUpdated).toBeNull()

    await act(async () => { await result.current.connect() })

    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    await waitFor(() => expect(result.current.balance.lastUpdated).not.toBeNull())
    await waitFor(() => expect(result.current.history.lastUpdated).not.toBeNull())

    expect(result.current.connection.error).toBeNull()
    expect(result.current.connection.lastUpdated).not.toBeNull()
    expect(new Date(result.current.connection.lastUpdated!).toString()).not.toBe('Invalid Date')
    expect(result.current.balance.error).toBeNull()
    expect(new Date(result.current.balance.lastUpdated!).toString()).not.toBe('Invalid Date')
    expect(result.current.history.error).toBeNull()
    expect(new Date(result.current.history.lastUpdated!).toString()).not.toBe('Invalid Date')
    // loading false after success
    expect(result.current.connection.loading).toBe(false)
    expect(result.current.balance.loading).toBe(false)
    expect(result.current.history.loading).toBe(false)
    // flat aliases
    expect(result.current.balanceError).toBeNull()
    expect(result.current.txError).toBeNull()
    expect(result.current.txLastUpdated).toBe(result.current.history.lastUpdated)
    expect(result.current.balanceLastUpdated).toBe(result.current.balance.lastUpdated)
  })

  it('refreshing balances does not erase valid history and refreshHistory does not erase balances', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '50.0000' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '2.0000000' }],
    })
    mockOperationsCall.mockResolvedValue({
      records: [{ type: 'payment', id: '10', transaction_hash: 'h10', amount: '0.001', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-01-01T00:00:00Z' }],
    })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('2.000000'))
    await waitFor(() => expect(result.current.transactions.length).toBe(1))

    const prevHistory = result.current.transactions[0]
    const prevHistoryLastUpdated = result.current.history.lastUpdated
    const prevBalanceLastUpdated = result.current.balance.lastUpdated

    // Balance refresh with new value — history untouched
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '60.0000' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '3.0000000' }],
    })
    await act(async () => { await result.current.refreshBalances() })
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('3.000000'))
    expect(result.current.transactions[0]).toEqual(prevHistory)
    expect(result.current.history.lastUpdated).toBe(prevHistoryLastUpdated)
    expect(result.current.balance.lastUpdated).not.toBe(prevBalanceLastUpdated)

    // History refresh with new tx — balance untouched
    const newHistoryLastUpdatedBefore = result.current.history.lastUpdated
    const balanceBefore = result.current.wallet.xlmBalance
    mockOperationsCall.mockResolvedValue({
      records: [
        { type: 'payment', id: '11', transaction_hash: 'h11', amount: '0.002', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-02-01T00:00:00Z' },
        { type: 'payment', id: '12', transaction_hash: 'h12', amount: '0.003', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-02-02T00:00:00Z' },
      ],
    })
    await act(async () => { await result.current.refreshHistory() })
    await waitFor(() => expect(result.current.transactions.length).toBe(2))
    expect(result.current.wallet.xlmBalance).toBe(balanceBefore)
    expect(result.current.history.lastUpdated).not.toBe(newHistoryLastUpdatedBefore)
    expect(result.current.balance.error).toBeNull()
    expect(result.current.history.error).toBeNull()
  })

  it('balance error preserves valid balances and history, sets only balance error/lastUpdated', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '20.0000' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '1.0000000' }],
    })
    mockOperationsCall.mockResolvedValue({
      records: [{ type: 'payment', id: '1', transaction_hash: 'h1', amount: '0.001', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-01-01T00:00:00Z' }],
    })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('1.000000'))
    const prevXlm = result.current.wallet.xlmBalance
    const prevUsdc = result.current.wallet.usdcBalance
    const prevTxLen = result.current.transactions.length
    const prevHistoryLastUpdated = result.current.history.lastUpdated
    const prevBalanceLastUpdated = result.current.balance.lastUpdated

    mockLoadAccount.mockRejectedValueOnce(new Error('Horizon balance down'))
    await act(async () => { await result.current.refreshBalances() })
    await waitFor(() => expect(result.current.balance.error).toBe('Horizon balance down'))
    expect(result.current.wallet.xlmBalance).toBe(prevXlm)
    expect(result.current.wallet.usdcBalance).toBe(prevUsdc)
    expect(result.current.transactions.length).toBe(prevTxLen)
    expect(result.current.history.error).toBeNull()
    expect(result.current.history.lastUpdated).toBe(prevHistoryLastUpdated)
    expect(result.current.balance.lastUpdated).toBe(prevBalanceLastUpdated)
    expect(result.current.balance.loading).toBe(false)
    // wallet.error (connection) stays null
    expect(result.current.wallet.error).toBeNull()
    expect(result.current.connection.error).toBeNull()
  })

  it('history error preserves valid history and balances, sets only history error/lastUpdated', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValue({
      records: [{ type: 'payment', id: '1', transaction_hash: 'h1', amount: '0.001', asset_type: 'native', from: 'GAAA', to: TEST_ADDRESS, created_at: '2026-01-01T00:00:00Z' }],
    })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.transactions.length).toBe(1))
    const prevTx = result.current.transactions[0]
    const prevBalance = result.current.wallet.usdcBalance
    const prevBalanceLastUpdated = result.current.balance.lastUpdated
    const prevHistoryLastUpdated = result.current.history.lastUpdated

    mockOperationsCall.mockRejectedValueOnce(new Error('Horizon history down'))
    await act(async () => { await result.current.refreshHistory() })
    await waitFor(() => expect(result.current.history.error).toBe('Horizon history down'))
    expect(result.current.transactions[0]).toEqual(prevTx)
    expect(result.current.wallet.usdcBalance).toBe(prevBalance)
    expect(result.current.balance.error).toBeNull()
    expect(result.current.balance.lastUpdated).toBe(prevBalanceLastUpdated)
    expect(result.current.history.lastUpdated).toBe(prevHistoryLastUpdated)
    expect(result.current.history.loading).toBe(false)
    expect(result.current.txError).toBe('Horizon history down')
  })

  it('connection error does not clear valid balance and history', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000' }],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))
    await waitFor(() => expect(result.current.balance.lastUpdated).not.toBeNull())

    const prevBalance = result.current.wallet.xlmBalance
    const prevHistoryLen = result.current.transactions.length
    const prevBalanceLastUpdated = result.current.balance.lastUpdated
    const prevHistoryLastUpdated = result.current.history.lastUpdated

    // Simulate connection failure on next connect attempt (e.g., Freighter not found)
    mockIsConnected.mockResolvedValue({ isConnected: false })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.connection.error).toMatch(/Freighter extension not found/))
    expect(result.current.wallet.xlmBalance).toBe(prevBalance)
    expect(result.current.transactions.length).toBe(prevHistoryLen)
    expect(result.current.balance.lastUpdated).toBe(prevBalanceLastUpdated)
    expect(result.current.history.lastUpdated).toBe(prevHistoryLastUpdated)
    // history and balance errors remain null
    expect(result.current.history.error).toBeNull()
    expect(result.current.balance.error).toBeNull()
  })

  it('balance and history loading states are independent', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({ balances: [{ asset_type: 'native', balance: '10.0000' }] })
    mockOperationsCall.mockResolvedValue({ records: [] })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.wallet.connected).toBe(true))

    // Balance refresh pending — history should not be loading
    let resolveBalance: (v: any) => void
    const balancePending = new Promise(resolve => { resolveBalance = resolve })
    mockLoadAccount.mockReturnValueOnce(balancePending as any)
    let balancePromise: Promise<void>
    act(() => { balancePromise = result.current.refreshBalances() })
    await waitFor(() => expect(result.current.balance.loading).toBe(true))
    expect(result.current.history.loading).toBe(false)

    resolveBalance!({ balances: [{ asset_type: 'native', balance: '5.0000' }] })
    await act(async () => { await balancePromise! })
    await waitFor(() => expect(result.current.balance.loading).toBe(false))
    expect(result.current.history.loading).toBe(false)

    // History refresh pending — balance should not be loading
    let resolveHistory: (v: any) => void
    const historyPending = new Promise(resolve => { resolveHistory = resolve })
    mockOperationsCall.mockReturnValueOnce(historyPending as any)
    let historyPromise: Promise<void>
    act(() => { historyPromise = result.current.refreshHistory() })
    await waitFor(() => expect(result.current.history.loading).toBe(true))
    expect(result.current.balance.loading).toBe(false)

    resolveHistory!({ records: [] })
    await act(async () => { await historyPromise! })
    await waitFor(() => expect(result.current.history.loading).toBe(false))
    expect(result.current.balance.loading).toBe(false)
  })

  it('disconnect clears lastUpdated and errors for all resources', async () => {
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.connection.lastUpdated).not.toBeNull())
    await waitFor(() => expect(result.current.balance.lastUpdated).not.toBeNull())
    await waitFor(() => expect(result.current.history.lastUpdated).not.toBeNull())

    act(() => { result.current.disconnect() })
    expect(result.current.connection.lastUpdated).toBeNull()
    expect(result.current.balance.lastUpdated).toBeNull()
    expect(result.current.history.lastUpdated).toBeNull()
    expect(result.current.connection.error).toBeNull()
    expect(result.current.balance.error).toBeNull()
    expect(result.current.history.error).toBeNull()
    expect(result.current.wallet.connected).toBe(false)
    expect(result.current.transactions).toEqual([])
  })
})
