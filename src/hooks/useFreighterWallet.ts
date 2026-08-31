/**
 * useFreighterWallet.ts
 * Real Freighter wallet integration using @stellar/freighter-api
 * Fetches live balances from Stellar Horizon
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  isConnected,
  requestAccess,
  getAddress,
  getNetwork,
} from '@stellar/freighter-api'
import { Horizon } from '@stellar/stellar-sdk'
import { HORIZON_URL, USDC_ISSUER } from '../lib/stellar'

export const TRANSACTIONS_PAGE_SIZE = 15

export interface WalletState {
  publicKey: string | null
  connected: boolean
  network: string
  xlmBalance: string
  usdcBalance: string
  loading: boolean
  error: string | null
}

export interface StellarTransaction {
  id: string
  hash: string
  type: string
  amount: string
  asset: string
  from: string
  to: string
  timestamp: string
  memo?: string
}

const horizon = new Horizon.Server(HORIZON_URL)

function mapOpsToTransactions(records: any[]): StellarTransaction[] {
  return records
    .filter((op: any) => op.type === 'payment' || op.type === 'create_account')
    .map((op: any) => ({
      id: op.id,
      hash: op.transaction_hash,
      type: op.type,
      amount: op.amount ? parseFloat(op.amount).toFixed(4) : '—',
      asset:
        op.asset_type === 'native' ? 'XLM' : op.asset_code || 'Unknown',
      from: op.from || op.funder || '',
      to: op.to || op.account || '',
      timestamp: op.created_at,
      memo: op.transaction?.memo,
    }))
}

/**
 * Custom React hook to manage connection, balances (XLM & USDC), and recent transaction history for the Freighter wallet on Stellar.
 * Transaction history is paginated with Horizon cursors: initial load fetches the latest page, `loadMore` appends older
 * records using the last paging_token as cursor with stable deduplication by operation id.
 *
 * @returns Object containing the current wallet state (`wallet`), list of recent transactions (`transactions`),
 * transaction loading state (`txLoading`), pagination states (`txLoadingMore`, `txHasMore`, `txError`), and action callbacks (`connect`, `disconnect`, `refresh`, `loadMore`).
 */
export function useFreighterWallet() {
  const [wallet, setWallet] = useState<WalletState>({
    publicKey: null,
    connected: false,
    network: 'TESTNET',
    xlmBalance: '0',
    usdcBalance: '0',
    loading: false,
    error: null,
  })
  const [transactions, setTransactions] = useState<StellarTransaction[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const [txLoadingMore, setTxLoadingMore] = useState(false)
  const [txHasMore, setTxHasMore] = useState(true)
  const [txError, setTxError] = useState<string | null>(null)
  const nextCursorRef = useRef<string | null>(null)
  const currentPublicKeyRef = useRef<string | null>(null)

  // Fetch real balances from Horizon
  const fetchBalances = useCallback(async (publicKey: string) => {
    try {
      const account = await horizon.loadAccount(publicKey)

      let xlm = '0'
      let usdc = '0'

      for (const balance of account.balances) {
        if (balance.asset_type === 'native') {
          xlm = parseFloat(balance.balance).toFixed(4)
        } else if (
          balance.asset_type === 'credit_alphanum4' &&
          (balance as any).asset_code === 'USDC' &&
          (balance as any).asset_issuer === USDC_ISSUER
        ) {
          usdc = parseFloat(balance.balance).toFixed(6)
        }
      }

      setWallet(prev => ({
        ...prev,
        xlmBalance: xlm,
        usdcBalance: usdc,
        error: null,
      }))
    } catch (err: any) {
      setWallet(prev => ({
        ...prev,
        error: err.message || 'Failed to load account',
      }))
    }
  }, [])

  // Fetch real transaction history from Horizon — initial page (resets pagination)
  const fetchTransactions = useCallback(async (publicKey: string) => {
    // Account switch: reset pagination and deduplication state
    const isSameAccount = currentPublicKeyRef.current === publicKey
    if (!isSameAccount) {
      setTransactions([])
    }
    currentPublicKeyRef.current = publicKey
    nextCursorRef.current = null
    setTxLoading(true)
    setTxError(null)
    setTxHasMore(true)
    setTxLoadingMore(false)
    try {
      const builder: any = horizon
        .operations()
        .forAccount(publicKey)
        .order('desc')
        .limit(TRANSACTIONS_PAGE_SIZE)
      const ops = await builder.call()

      const txs = mapOpsToTransactions(ops.records as any[])

      setTransactions(txs)
      if (ops.records.length > 0) {
        const last: any = ops.records[ops.records.length - 1]
        nextCursorRef.current = last.paging_token || last.id || null
      } else {
        nextCursorRef.current = null
      }
      setTxHasMore(ops.records.length === TRANSACTIONS_PAGE_SIZE)
      setTxError(null)
    } catch (err: any) {
      // Preserve existing transactions on load-more failure; on initial load keep current (may be empty after switch)
      if (!isSameAccount) {
        setTransactions([])
      }
      setTxError(err?.message || 'Failed to load transactions')
      // On initial fetch failure we keep hasMore true so retry is possible
      setTxHasMore(true)
    } finally {
      setTxLoading(false)
    }
  }, [])

  // Connect Freighter wallet
  const connect = useCallback(async () => {
    setWallet(prev => ({ ...prev, loading: true, error: null }))

    try {
      const connected = await isConnected()
      if (!connected.isConnected) {
        throw new Error(
          'Freighter extension not found. Install it from freighter.app'
        )
      }

      const accessResult = await requestAccess()
      if (accessResult.error) {
        throw new Error(accessResult.error.message)
      }

      const addressResult = await getAddress()
      if (addressResult.error || !addressResult.address) {
        throw new Error('Could not get wallet address')
      }

      const networkResult = await getNetwork()
      const network = networkResult.network || 'TESTNET'

      setWallet(prev => ({
        ...prev,
        publicKey: addressResult.address,
        connected: true,
        network,
        loading: false,
        error: null,
      }))

      // Fetch live data after connect
      await fetchBalances(addressResult.address)
      await fetchTransactions(addressResult.address)
    } catch (err: any) {
      setWallet(prev => ({
        ...prev,
        loading: false,
        connected: false,
        error: err.message || 'Connection failed',
      }))
    }
  }, [fetchBalances, fetchTransactions])

  // Load older records with Horizon cursor and stable deduplication
  const loadMore = useCallback(async () => {
    const publicKey = currentPublicKeyRef.current || wallet.publicKey
    if (!publicKey) return
    if (txLoading || txLoadingMore || !txHasMore) return
    setTxLoadingMore(true)
    setTxError(null)
    try {
      let builder: any = horizon
        .operations()
        .forAccount(publicKey)
        .order('desc')
        .limit(TRANSACTIONS_PAGE_SIZE)
      if (nextCursorRef.current) {
        builder = builder.cursor(nextCursorRef.current)
      }
      const ops = await builder.call()
      const txs = mapOpsToTransactions(ops.records as any[])

      if (ops.records.length > 0) {
        const last: any = ops.records[ops.records.length - 1]
        nextCursorRef.current = last.paging_token || last.id || null
      }
      setTxHasMore(ops.records.length === TRANSACTIONS_PAGE_SIZE)

      // Stable deduplication by operation id
      if (txs.length > 0) {
        setTransactions(prev => {
          const seen = new Set(prev.map(p => p.id))
          const deduped = txs.filter(t => !seen.has(t.id))
          if (deduped.length === 0) return prev
          return [...prev, ...deduped]
        })
      }
      setTxError(null)
    } catch (err: any) {
      setTxError(err?.message || 'Failed to load more transactions')
    } finally {
      setTxLoadingMore(false)
    }
  }, [wallet.publicKey, txLoading, txLoadingMore, txHasMore])

  const disconnect = useCallback(() => {
    setWallet({
      publicKey: null,
      connected: false,
      network: 'TESTNET',
      xlmBalance: '0',
      usdcBalance: '0',
      loading: false,
      error: null,
    })
    setTransactions([])
    setTxHasMore(true)
    setTxError(null)
    setTxLoading(false)
    setTxLoadingMore(false)
    nextCursorRef.current = null
    currentPublicKeyRef.current = null
  }, [])

  const refresh = useCallback(async () => {
    if (wallet.publicKey) {
      await fetchBalances(wallet.publicKey)
      await fetchTransactions(wallet.publicKey)
    }
  }, [wallet.publicKey, fetchBalances, fetchTransactions])

  // Auto-check if already connected on mount
  useEffect(() => {
    const check = async () => {
      try {
        const connected = await isConnected()
        if (connected.isConnected) {
          const addr = await getAddress()
          if (addr.address) {
            const net = await getNetwork()
            setWallet(prev => ({
              ...prev,
              publicKey: addr.address,
              connected: true,
              network: net.network || 'TESTNET',
            }))
            fetchBalances(addr.address)
            fetchTransactions(addr.address)
          }
        }
      } catch {
        // Freighter not installed, silent fail
      }
    }
    check()
  }, [fetchBalances, fetchTransactions])

  return {
    wallet,
    transactions,
    txLoading,
    txLoadingMore,
    txHasMore,
    txError,
    connect,
    disconnect,
    refresh,
    loadMore,
    fetchTransactions,
  }
}
