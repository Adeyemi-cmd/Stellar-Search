import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { initI18n, loadNamespace } from '../i18n'

// The hook's error messages route through i18next (#345) — in the real app
// main.tsx initializes it and loads `errors` before anything renders;
// mirror that here so those messages resolve instead of coming back
// undefined.
beforeAll(async () => {
  await initI18n()
  await loadNamespace('errors')
})

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

const { mockLoadAccount, mockOperationsCall, mockCursor, mockCapturedCursor, mockTransactionsCall, mockSingleTransactionCall } = vi.hoisted(() => ({
  mockLoadAccount: vi.fn(),
  mockOperationsCall: vi.fn(),
  mockCursor: vi.fn(),
  mockCapturedCursor: { value: null as string | null },
  mockTransactionsCall: vi.fn(),
  mockSingleTransactionCall: vi.fn(),
}))

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const orig: any = await importOriginal()
  class MockHorizonServer {
    loadAccount = mockLoadAccount
    operations() {
      return {
        forAccount: () => ({
          order: () => ({
            limit: () => {
              const builder: any = {
                call: mockOperationsCall,
                cursor: vi.fn((c: string) => {
                  mockCursor(c)
                  mockCapturedCursor.value = c
                  return { call: mockOperationsCall }
                }),
              }
              return builder
            },
          }),
        }),
      }
    }
    transactions() {
      return {
        forAccount: () => ({
          order: () => ({
            limit: () => ({
              call: mockTransactionsCall,
            }),
          }),
        }),
        transaction: (hash: string) => ({
          call: () => mockSingleTransactionCall(hash),
        }),
      }
    }
  }
  return {
    ...orig,
    Horizon: { Server: MockHorizonServer },
  }
})

import { useFreighterWallet, TRANSACTIONS_PAGE_SIZE, extractSafeMemo } from './useFreighterWallet'

const TEST_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
const OTHER_ADDRESS = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB123'

// The hook lazy-loads the Freighter SDK, so the mount auto-check resolves
// asynchronously. Give it a tick to observe the disconnected state before a
// test flips the mock to connected — otherwise the auto-check double-fetches
// and consumes the test's `mockResolvedValueOnce` pages.
async function flushMountCheck() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

function makePaymentRecords(count: number, startId: number, opts?: { prefix?: string; pagingBase?: number }) {
  return Array.from({ length: count }, (_, i) => {
    const idNum = startId + i
    return {
      type: 'payment',
      id: String(idNum),
      paging_token: String(opts?.pagingBase != null ? opts.pagingBase + i : idNum),
      transaction_hash: `hash-${idNum}`,
      amount: '0.001',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      from: 'GAAA',
      to: TEST_ADDRESS,
      created_at: '2026-01-01T00:00:00Z',
    }
  })
}

describe('extractSafeMemo — transaction memo extraction & normalization', () => {
  it('returns undefined for none memo_type or empty / null values', () => {
    expect(extractSafeMemo('something', 'none')).toBeUndefined()
    expect(extractSafeMemo(null)).toBeUndefined()
    expect(extractSafeMemo(undefined)).toBeUndefined()
    expect(extractSafeMemo('')).toBeUndefined()
    expect(extractSafeMemo('   ')).toBeUndefined()
  })

  it('safely extracts text and trimmed string memos', () => {
    expect(extractSafeMemo('  search query memo  ', 'text')).toBe('search query memo')
    expect(extractSafeMemo('order-123')).toBe('order-123')
  })

  it('safely extracts numeric and ID memo representations', () => {
    expect(extractSafeMemo(123456789, 'id')).toBe('123456789')
    expect(extractSafeMemo(BigInt(987654321))).toBe('987654321')
    expect(extractSafeMemo('99999', 'id')).toBe('99999')
  })

  it('safely extracts buffer and object memo representations without throwing', () => {
    const buf = Buffer.from('hello buffer memo')
    expect(extractSafeMemo(buf)).toBe('hello buffer memo')
    expect(extractSafeMemo({ key: 'val' })).toBe('{"key":"val"}')
  })
})

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
    mockTransactionsCall.mockResolvedValue({ records: [] })
    mockSingleTransactionCall.mockRejectedValue(new Error('Not found'))
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
    expect(mockLoadAccount).toHaveBeenCalledWith(TEST_ADDRESS)
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
    await waitFor(() => expect(result.current.wallet.usdcBalance).toBe('0.123457'))
    expect(result.current.wallet.xlmBalance).toBe('100.0000')
  })

  it('handles Horizon payment operations mapping and expanded transaction memo lookup', async () => {
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
          // op.transaction is omitted by Horizon operations endpoint by default
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
          type: 'payment',
          id: '3',
          transaction_hash: 'ghi789',
          amount: '5.000',
          asset_type: 'native',
          from: 'GBBB',
          to: TEST_ADDRESS,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
    })

    // horizon.transactions().forAccount() supplies transaction details & memos
    mockTransactionsCall.mockResolvedValue({
      records: [
        { hash: 'abc123', memo: 'x402 search payment', memo_type: 'text' },
        { hash: 'def456', memo: '100200300', memo_type: 'id' },
      ],
    })

    // Single transaction fallback for 'ghi789'
    mockSingleTransactionCall.mockImplementation(async (hash: string) => {
      if (hash === 'ghi789') {
        return { hash: 'ghi789', memo: undefined, memo_type: 'none' }
      }
      throw new Error('Not found')
    })

    const { result } = renderHook(() => useFreighterWallet())
    await act(async () => {
      await result.current.connect()
    })
    await waitFor(() => expect(result.current.transactions.length).toBe(3))

    expect(result.current.transactions[0].hash).toBe('abc123')
    expect(result.current.transactions[0].asset).toBe('USDC')
    expect(result.current.transactions[0].memo).toBe('x402 search payment')

    expect(result.current.transactions[1].type).toBe('create_account')
    expect(result.current.transactions[1].memo).toBe('100200300')

    expect(result.current.transactions[2].hash).toBe('ghi789')
    expect(result.current.transactions[2].memo).toBeUndefined()
  })
})

describe('useFreighterWallet — paginated Horizon history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCapturedCursor.value = null
    mockIsConnected.mockResolvedValue({ isConnected: false })
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000' }],
    })
    mockOperationsCall.mockResolvedValue({ records: [] })
  })

  it('older records load with Horizon cursors and stable deduplication', async () => {
    const page1 = makePaymentRecords(TRANSACTIONS_PAGE_SIZE, 1)
    const page2 = makePaymentRecords(TRANSACTIONS_PAGE_SIZE, TRANSACTIONS_PAGE_SIZE + 1)
    // page2 will have first id duplicate of page1 last? Use distinct for first loadMore, then duplicate test via same hook second load
    const page3 = [page1[0], ...makePaymentRecords(2, 300)]
    page3[0].id = '1'
    page3[0].paging_token = '1'

    const { result } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    // connect -> page1
    mockOperationsCall.mockResolvedValueOnce({ records: page1 })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE))
    expect(result.current.txHasMore).toBe(true)
    expect(mockCursor).not.toHaveBeenCalled()

    // loadMore -> page2
    mockOperationsCall.mockResolvedValueOnce({ records: page2 })
    await act(async () => { await result.current.loadMore() })
    await waitFor(() => expect(result.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE * 2))
    expect(mockCursor).toHaveBeenCalledWith(String(TRANSACTIONS_PAGE_SIZE))
    expect(mockCapturedCursor.value).toBe(String(TRANSACTIONS_PAGE_SIZE))
    const ids = result.current.transactions.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)

    // second loadMore with duplicate id '1' should deduplicate
    mockOperationsCall.mockResolvedValueOnce({ records: page3 })
    await act(async () => { await result.current.loadMore() })
    await waitFor(() => expect(result.current.txLoadingMore).toBe(false))
    // page3 has 3 records but one duplicate ('1'), so only 2 new should be appended
    expect(result.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE * 2 + 2)
    const ids2 = result.current.transactions.map(t => t.id)
    expect(ids2.filter(id => id === '1').length).toBe(1)
  })

  it('exposes loading states for initial and paginated fetches', async () => {
    const { result } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockLoadAccount.mockResolvedValue({ balances: [{ asset_type: 'native', balance: '0' }] })
    let resolveOps: (v: any) => void
    const pendingPromise = new Promise(resolve => { resolveOps = resolve })
    mockOperationsCall.mockReturnValueOnce(pendingPromise as any)

    let connectPromise: Promise<void>
    act(() => { connectPromise = result.current.connect() })
    await waitFor(() => expect(result.current.txLoading).toBe(true))
    resolveOps!({ records: makePaymentRecords(2, 1) })
    await act(async () => { await connectPromise! })
    await waitFor(() => expect(result.current.txLoading).toBe(false))

    // now test txLoadingMore with a full page to keep hasMore true
    mockIsConnected.mockResolvedValue({ isConnected: false })
    const { result: r2 } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValueOnce({ records: makePaymentRecords(TRANSACTIONS_PAGE_SIZE, 10) })
    await act(async () => { await r2.current.connect() })
    await waitFor(() => expect(r2.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE))
    expect(r2.current.txHasMore).toBe(true)

    let resolveMore: (v: any) => void
    const morePromise = new Promise(resolve => { resolveMore = resolve })
    mockOperationsCall.mockReturnValueOnce(morePromise as any)
    let loadPromise: Promise<void>
    act(() => { loadPromise = r2.current.loadMore() })
    await waitFor(() => expect(r2.current.txLoadingMore).toBe(true))
    resolveMore!({ records: makePaymentRecords(1, 99) })
    await act(async () => { await loadPromise! })
    await waitFor(() => expect(r2.current.txLoadingMore).toBe(false))
  })

  it('detects end-of-list when fewer than page size records returned', async () => {
    const few = makePaymentRecords(3, 1)
    const { result } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValueOnce({ records: few })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.transactions.length).toBe(3))
    expect(result.current.txHasMore).toBe(false)
    expect(result.current.txError).toBeNull()

    const callCountBefore = mockOperationsCall.mock.calls.length
    await act(async () => { await result.current.loadMore() })
    expect(mockOperationsCall.mock.calls.length).toBe(callCountBefore)

    const full = makePaymentRecords(TRANSACTIONS_PAGE_SIZE, 20)
    const partial = makePaymentRecords(2, 40)
    mockOperationsCall.mockReset()
    mockCursor.mockClear()
    mockIsConnected.mockResolvedValue({ isConnected: false })
    const { result: r2 } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValueOnce({ records: full })
    await act(async () => { await r2.current.connect() })
    await waitFor(() => expect(r2.current.txHasMore).toBe(true))
    mockOperationsCall.mockResolvedValueOnce({ records: partial })
    await act(async () => { await r2.current.loadMore() })
    await waitFor(() => expect(r2.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE + 2))
    expect(r2.current.txHasMore).toBe(false)
  })

  it('exposes retry after failed initial load and after failed loadMore', async () => {
    const { result } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockRejectedValueOnce(new Error('Horizon unavailable'))
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.txError).toBe('Horizon unavailable'))
    expect(result.current.transactions).toEqual([])
    expect(result.current.txHasMore).toBe(true)
    expect(result.current.txLoading).toBe(false)

    mockOperationsCall.mockResolvedValueOnce({ records: makePaymentRecords(2, 1) })
    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.transactions.length).toBe(2))
    expect(result.current.txError).toBeNull()

    const full = makePaymentRecords(TRANSACTIONS_PAGE_SIZE, 50)
    mockOperationsCall.mockReset()
    mockIsConnected.mockResolvedValue({ isConnected: false })
    const { result: r2 } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValueOnce({ records: full })
    await act(async () => { await r2.current.connect() })
    await waitFor(() => expect(r2.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE))
    expect(r2.current.txHasMore).toBe(true)
    mockOperationsCall.mockRejectedValueOnce(new Error('network timeout'))
    await act(async () => { await r2.current.loadMore() })
    await waitFor(() => expect(r2.current.txError).toBe('network timeout'))
    expect(r2.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE)
    expect(r2.current.txHasMore).toBe(true)
    expect(r2.current.txLoadingMore).toBe(false)

    mockOperationsCall.mockResolvedValueOnce({ records: makePaymentRecords(3, 80) })
    await act(async () => { await r2.current.loadMore() })
    await waitFor(() => expect(r2.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE + 3))
    expect(r2.current.txError).toBeNull()
  })

  it('resets pagination and deduplication on account switch', async () => {
    const addrA = TEST_ADDRESS
    const addrB = OTHER_ADDRESS
    const recordsA = makePaymentRecords(TRANSACTIONS_PAGE_SIZE, 1)
    const recordsB = makePaymentRecords(2, 100)
    const { result } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: addrA })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValueOnce({ records: recordsA })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE))
    expect(result.current.wallet.publicKey).toBe(addrA)

    mockOperationsCall.mockResolvedValueOnce({ records: recordsB })
    await act(async () => { await result.current.fetchTransactions(addrB) })
    await waitFor(() => expect(result.current.transactions.length).toBe(2))
    expect(result.current.transactions[0].id).toBe('100')
    expect(result.current.txHasMore).toBe(false)
    expect(result.current.txError).toBeNull()
    mockOperationsCall.mockReset()
    mockCursor.mockClear()
    mockCapturedCursor.value = null
    const fullB = makePaymentRecords(TRANSACTIONS_PAGE_SIZE, 500)
    mockOperationsCall.mockResolvedValueOnce({ records: fullB })
    await act(async () => { await result.current.fetchTransactions(addrB) })
    await waitFor(() => expect(result.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE))
    expect(result.current.transactions[0].id).toBe('500')
    mockOperationsCall.mockResolvedValueOnce({ records: makePaymentRecords(2, 600) })
    await act(async () => { await result.current.loadMore() })
    await waitFor(() => expect(result.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE + 2))
    expect(mockCursor).toHaveBeenCalledWith('514')
  })

  it('disconnect clears pagination state for next account', async () => {
    const { result } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValueOnce({ records: makePaymentRecords(TRANSACTIONS_PAGE_SIZE, 1) })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.transactions.length).toBe(TRANSACTIONS_PAGE_SIZE))
    expect(result.current.txHasMore).toBe(true)
    act(() => { result.current.disconnect() })
    expect(result.current.transactions).toEqual([])
    expect(result.current.txHasMore).toBe(true)
    expect(result.current.txError).toBeNull()
    expect(result.current.txLoading).toBe(false)
    expect(result.current.txLoadingMore).toBe(false)
  })

  it('prevents concurrent loadMore and respects hasMore guard', async () => {
    const full = makePaymentRecords(TRANSACTIONS_PAGE_SIZE, 1)
    const { result } = renderHook(() => useFreighterWallet())
    await flushMountCheck()
    mockIsConnected.mockResolvedValue({ isConnected: true })
    mockRequestAccess.mockResolvedValue({})
    mockGetAddress.mockResolvedValue({ address: TEST_ADDRESS })
    mockGetNetwork.mockResolvedValue({ network: 'TESTNET' })
    mockOperationsCall.mockResolvedValueOnce({ records: full })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.txHasMore).toBe(true))
    let pendingResolve: (v: any) => void
    const pending = new Promise(resolve => { pendingResolve = resolve })
    mockOperationsCall.mockReturnValueOnce(pending as any)
    act(() => { result.current.loadMore() })
    await waitFor(() => expect(result.current.txLoadingMore).toBe(true))
    const callsBefore = mockOperationsCall.mock.calls.length
    await act(async () => { await result.current.loadMore() })
    expect(mockOperationsCall.mock.calls.length).toBe(callsBefore)
    pendingResolve!({ records: makePaymentRecords(2, 99) })
    await waitFor(() => expect(result.current.txLoadingMore).toBe(false))
  })
})
