import { render, screen, fireEvent, act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { useState } from 'react'
import {
  ModalProvider,
  useModal,
  useRegisterModal,
  useIsModalOpen,
  useCloseAll,
  ModalRegistry,
  isBrowser,
  type ModalProps
} from '../src/index'

function TestModal({ isOpen, data, close }: ModalProps<{ message?: string }, string | boolean>) {
  if (!isOpen) return <div data-testid="modal-closed">Closing...</div>
  return (
    <div data-testid="modal-open">
      <span>Message: {data?.message ?? 'none'}</span>
      <button data-testid="confirm-btn" onClick={() => close('confirmed')}>Confirm</button>
      <button data-testid="cancel-btn" onClick={() => close(false)}>Cancel</button>
      <button data-testid="dismiss-btn" onClick={() => close()}>Dismiss</button>
    </div>
  )
}

describe('react-modal-registry (basic test suite)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  describe('ModalProvider', () => {
    it('throws error when hooks are used outside ModalProvider', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(() => {
        renderHook(() => useModal('sample'))
      }).toThrow('useModalContext must be used within <ModalProvider>')
      consoleError.mockRestore()
    })

    it('renders children within ModalProvider', () => {
      render(
        <ModalProvider>
          <div data-testid="app-child">Child Content</div>
        </ModalProvider>
      )
      expect(screen.getByTestId('app-child')).toBeDefined()
    })
  })

  describe('Modal Registration', () => {
    it('registers and unregisters modal via useRegisterModal hook', async () => {
      function RegisteredApp() {
        useRegisterModal('testModal', TestModal)
        const modal = useModal('testModal')
        return <button data-testid="open-btn" onClick={() => modal.open({ message: 'Hello' })}>Open</button>
      }

      function Parent() {
        const [mounted, setMounted] = useState(true)
        return (
          <div>
            <button data-testid="toggle-btn" onClick={() => setMounted(m => !m)}>Toggle</button>
            {mounted ? <RegisteredApp /> : null}
          </div>
        )
      }

      render(
        <ModalProvider unmountDelay={0}>
          <Parent />
        </ModalProvider>
      )

      fireEvent.click(screen.getByTestId('open-btn'))
      expect(screen.getByTestId('modal-open')).toBeDefined()
      expect(screen.getByText('Message: Hello')).toBeDefined()

      // Unmount registration
      fireEvent.click(screen.getByTestId('toggle-btn'))
      expect(screen.queryByTestId('modal-open')).toBeNull()
    })

    it('registers modals declaratively via <ModalRegistry>', async () => {
      const modals = [{ id: 'batchModal', component: TestModal }] as const

      function App() {
        const modal = useModal('batchModal')
        return (
          <>
            <ModalRegistry modals={modals} />
            <button data-testid="open-batch" onClick={() => modal.open({ message: 'Batch' })}>Open</button>
          </>
        )
      }

      render(
        <ModalProvider unmountDelay={0}>
          <App />
        </ModalProvider>
      )

      fireEvent.click(screen.getByTestId('open-batch'))
      expect(screen.getByText('Message: Batch')).toBeDefined()
    })

    it('rejects with error when opening an unregistered modal', async () => {
      let errorThrown: Error | null = null

      function App() {
        const modal = useModal('unregisteredModal')
        return (
          <button
            data-testid="open-unregistered"
            onClick={() => {
              modal.open().catch((err: Error) => {
                errorThrown = err
              })
            }}
          >
            Open
          </button>
        )
      }

      render(
        <ModalProvider>
          <App />
        </ModalProvider>
      )

      fireEvent.click(screen.getByTestId('open-unregistered'))
      await act(async () => {})
      expect(errorThrown).toBeInstanceOf(Error)
      expect((errorThrown as unknown as Error)?.message).toContain('is not registered')
    })
  })

  describe('Promise Resolution & Actions', () => {
    it('resolves promise with confirmed result', async () => {
      let resolvedValue: unknown = null

      function App() {
        useRegisterModal('test', TestModal)
        const modal = useModal('test')
        return (
          <button
            data-testid="open-btn"
            onClick={async () => {
              resolvedValue = await modal.open({ message: 'Confirm test' })
            }}
          >
            Open
          </button>
        )
      }

      render(
        <ModalProvider unmountDelay={0}>
          <App />
        </ModalProvider>
      )

      fireEvent.click(screen.getByTestId('open-btn'))
      fireEvent.click(screen.getByTestId('confirm-btn'))

      await act(async () => {})
      expect(resolvedValue).toBe('confirmed')
      expect(screen.queryByTestId('modal-open')).toBeNull()
    })

    it('resolves promise with undefined when dismissed without value', async () => {
      let resolvedValue: unknown = 'initial'

      function App() {
        useRegisterModal('test', TestModal)
        const modal = useModal('test')
        return (
          <button
            data-testid="open-btn"
            onClick={async () => {
              resolvedValue = await modal.open()
            }}
          >
            Open
          </button>
        )
      }

      render(
        <ModalProvider unmountDelay={0}>
          <App />
        </ModalProvider>
      )

      fireEvent.click(screen.getByTestId('open-btn'))
      fireEvent.click(screen.getByTestId('dismiss-btn'))

      await act(async () => {})
      expect(resolvedValue).toBeUndefined()
    })

    it('deduplicates rapid open calls with identical data', async () => {
      let callCount = 0

      function CountingModal({ isOpen }: ModalProps) {
        if (!isOpen) return null
        callCount++
        return <div data-testid="counting-modal">Count: {callCount}</div>
      }

      function App() {
        useRegisterModal('count', CountingModal)
        const modal = useModal('count')
        return (
          <button
            data-testid="spam-btn"
            onClick={() => {
              modal.open({ value: 1 })
              modal.open({ value: 1 })
              modal.open({ value: 1 })
            }}
          >
            Spam
          </button>
        )
      }

      render(
        <ModalProvider unmountDelay={0}>
          <App />
        </ModalProvider>
      )

      fireEvent.click(screen.getByTestId('spam-btn'))
      expect(callCount).toBe(1)
    })
  })

  describe('Reactive State & Lifecycle', () => {
    it('tracks modal open status via useIsModalOpen hook', () => {
      function StatusViewer() {
        const isOpen = useIsModalOpen('statusModal')
        return <span data-testid="status-val">{isOpen ? 'OPEN' : 'CLOSED'}</span>
      }

      function App() {
        useRegisterModal('statusModal', TestModal)
        const modal = useModal('statusModal')
        return (
          <>
            <StatusViewer />
            <button data-testid="open-btn" onClick={() => modal.open()}>Open</button>
            <button data-testid="close-btn" onClick={() => modal.close()}>Close</button>
          </>
        )
      }

      render(
        <ModalProvider unmountDelay={0}>
          <App />
        </ModalProvider>
      )

      expect(screen.getByTestId('status-val').textContent).toBe('CLOSED')

      fireEvent.click(screen.getByTestId('open-btn'))
      expect(screen.getByTestId('status-val').textContent).toBe('OPEN')

      fireEvent.click(screen.getByTestId('close-btn'))
      expect(screen.getByTestId('status-val').textContent).toBe('CLOSED')
    })

    it('closes all modals via useCloseAll', () => {
      function ModalA({ isOpen }: ModalProps) {
        return isOpen ? <div data-testid="modal-a">A</div> : null
      }
      function ModalB({ isOpen }: ModalProps) {
        return isOpen ? <div data-testid="modal-b">B</div> : null
      }

      function App() {
        useRegisterModal('a', ModalA)
        useRegisterModal('b', ModalB)
        const modalA = useModal('a')
        const modalB = useModal('b')
        const closeAll = useCloseAll()

        return (
          <>
            <button data-testid="open-both" onClick={() => { modalA.open(); modalB.open() }}>Open Both</button>
            <button data-testid="close-all" onClick={() => closeAll()}>Close All</button>
          </>
        )
      }

      render(
        <ModalProvider unmountDelay={0}>
          <App />
        </ModalProvider>
      )

      fireEvent.click(screen.getByTestId('open-both'))
      expect(screen.getByTestId('modal-a')).toBeDefined()
      expect(screen.getByTestId('modal-b')).toBeDefined()

      fireEvent.click(screen.getByTestId('close-all'))
      expect(screen.queryByTestId('modal-a')).toBeNull()
      expect(screen.queryByTestId('modal-b')).toBeNull()
    })

    it('respects unmountDelay for exit animations', () => {
      function App() {
        useRegisterModal('delayModal', TestModal)
        const modal = useModal('delayModal')
        return (
          <>
            <button data-testid="open-btn" onClick={() => modal.open()}>Open</button>
            <button data-testid="close-btn" onClick={() => modal.close()}>Close</button>
          </>
        )
      }

      render(
        <ModalProvider unmountDelay={300}>
          <App />
        </ModalProvider>
      )

      fireEvent.click(screen.getByTestId('open-btn'))
      expect(screen.getByTestId('modal-open')).toBeDefined()

      fireEvent.click(screen.getByTestId('close-btn'))
      // During exit animation, isOpen becomes false but component remains in DOM
      expect(screen.getByTestId('modal-closed')).toBeDefined()

      // Advance timers by unmountDelay
      act(() => {
        vi.advanceTimersByTime(300)
      })

      // Completely unmounted from DOM
      expect(screen.queryByTestId('modal-closed')).toBeNull()
      expect(screen.queryByTestId('modal-open')).toBeNull()
    })
  })

  describe('URL Routing & Utilities', () => {
    it('detects browser environment accurately with isBrowser()', () => {
      expect(isBrowser()).toBe(true)
    })

    it('syncs open modal ID to URL hash and cleans URL on close', () => {
      window.history.replaceState({}, '', '/')

      function App() {
        useRegisterModal('routeModal', TestModal)
        const modal = useModal('routeModal')
        return (
          <>
            <button data-testid="open-btn" onClick={() => modal.open()}>Open</button>
            <button data-testid="close-btn" onClick={() => modal.close()}>Close</button>
          </>
        )
      }

      render(
        <ModalProvider routing={{ strategy: 'hash', param: 'modal' }}>
          <App />
        </ModalProvider>
      )

      expect(window.location.hash).toBe('')

      fireEvent.click(screen.getByTestId('open-btn'))
      expect(window.location.hash).toBe('#modal=routeModal')

      fireEvent.click(screen.getByTestId('close-btn'))
      expect(window.location.hash).toBe('')
    })
  })
})
