import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DashboardPage } from './DashboardPage'
import type { StellarTransaction } from '../hooks/useFreighterWallet'

vi.mock('framer-motion', async () => {
  const actual: any = await vi.importActual('framer-motion')
  return {
    ...actual,
    motion: {
      div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
      button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
  }
})

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))

const TEST_TX: StellarTransaction = {
  id: '1',
  hash: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd',
  type: 'payment',
  amount: '0.0010',
  asset: 'USDC',
  from: 'GAAA',
  to: 'GBBB',
  timestamp: new Date(Date.now() - 60000).toISOString(),
}

function makeTxs(count: number): StellarTransaction[] {
  return Array.from({ length: count }, (_, i) => ({
    ...TEST_TX,
    id: String(i + 1),
    hash: `hash${i + 1}`.padEnd(64, '0'),
  }))
}

describe('DashboardPage — paginated transaction history', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('shows initial loading spinner when txLoading and no transactions', () => {
    render(
      <DashboardPage
        transactions={[]}
        txLoading={true}
        publicKey="GTEST"
        usdcBalance="0"
        xlmBalance="0"
        onRefresh={vi.fn()}
      />
    )
    // header present
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument()
    // no transactions yet not shown when loading
    expect(screen.queryByText('NO TRANSACTIONS YET')).not.toBeInTheDocument()
  })

  it('shows initial error with retry when txError and no transactions', () => {
    const onRefresh = vi.fn()
    render(
      <DashboardPage
        transactions={[]}
        txLoading={false}
        txError="Horizon unavailable"
        publicKey="GTEST"
        usdcBalance="0"
        xlmBalance="0"
        onRefresh={onRefresh}
      />
    )
    expect(screen.getByText('FAILED TO LOAD TRANSACTIONS')).toBeInTheDocument()
    expect(screen.getByText('Horizon unavailable')).toBeInTheDocument()
    const retry = screen.getByText('RETRY')
    fireEvent.click(retry)
    expect(onRefresh).toHaveBeenCalled()
  })

  it('renders transactions and load more button when hasMore true', () => {
    const onLoadMore = vi.fn()
    render(
      <DashboardPage
        transactions={makeTxs(2)}
        txLoading={false}
        txHasMore={true}
        publicKey="GTEST"
        usdcBalance="1.00"
        xlmBalance="10.00"
        onRefresh={vi.fn()}
        onLoadMore={onLoadMore}
      />
    )
    expect(screen.getAllByText('CONFIRMED').length).toBe(2)
    const btn = screen.getByText('LOAD OLDER TRANSACTIONS')
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('shows loading indicator when txLoadingMore true', () => {
    render(
      <DashboardPage
        transactions={makeTxs(1)}
        txLoading={false}
        txLoadingMore={true}
        txHasMore={true}
        publicKey="GTEST"
        usdcBalance="0"
        xlmBalance="0"
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText('LOADING OLDER TRANSACTIONS...')).toBeInTheDocument()
    expect(screen.queryByText('LOAD OLDER TRANSACTIONS')).not.toBeInTheDocument()
  })

  it('shows retry when txError with existing transactions', () => {
    const onLoadMore = vi.fn()
    render(
      <DashboardPage
        transactions={makeTxs(1)}
        txLoading={false}
        txError="network timeout"
        txHasMore={true}
        publicKey="GTEST"
        usdcBalance="0"
        xlmBalance="0"
        onRefresh={vi.fn()}
        onLoadMore={onLoadMore}
      />
    )
    expect(screen.getByText('network timeout')).toBeInTheDocument()
    const retry = screen.getByText('RETRY')
    fireEvent.click(retry)
    expect(onLoadMore).toHaveBeenCalled()
  })

  it('shows end-of-list when hasMore false', () => {
    render(
      <DashboardPage
        transactions={makeTxs(2)}
        txLoading={false}
        txHasMore={false}
        publicKey="GTEST"
        usdcBalance="0"
        xlmBalance="0"
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText('END OF TRANSACTION HISTORY')).toBeInTheDocument()
    expect(screen.queryByText('LOAD OLDER TRANSACTIONS')).not.toBeInTheDocument()
  })

  it('clears old records on account switch (rerender with different publicKey and transactions)', () => {
    const { rerender } = render(
      <DashboardPage
        transactions={makeTxs(3)}
        txLoading={false}
        txHasMore={true}
        publicKey="GAAA"
        usdcBalance="0"
        xlmBalance="0"
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getAllByText('CONFIRMED').length).toBe(3)
    // switch to different account with different transactions
    rerender(
      <DashboardPage
        transactions={makeTxs(1)}
        txLoading={false}
        txHasMore={false}
        publicKey="GBBB"
        usdcBalance="0"
        xlmBalance="0"
        onRefresh={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getAllByText('CONFIRMED').length).toBe(1)
    expect(screen.getByText('GBBB')).toBeInTheDocument()
  })

  it('shows no transactions state when not connected', () => {
    render(
      <DashboardPage
        transactions={[]}
        txLoading={false}
        publicKey={null}
        usdcBalance="0"
        xlmBalance="0"
        onRefresh={vi.fn()}
      />
    )
    expect(screen.getByText('NO TRANSACTIONS YET')).toBeInTheDocument()
    expect(screen.getByText('Connect your wallet to see your history')).toBeInTheDocument()
  })
})
