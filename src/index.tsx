'use client'

import {
  createContext,
  memo,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from 'react'

/**
 * Canonical registry for modal payloads and return types via module augmentation (e.g., `env.d.ts` or `modals.d.ts`).
 *
 * @example
 * ```ts
 * declare module 'react-modal-registry' {
 *   interface ModalRegistry {
 *     confirmAction: { data: { itemId: string }; result: boolean }
 *     simpleAlert: void
 *   }
 * }
 * ```
 */
export interface ModalRegistry { }

export type RegisteredModalId = keyof ModalRegistry
export type ModalId = [RegisteredModalId] extends [never] ? string : RegisteredModalId

export type ModalData<TId extends ModalId> = TId extends keyof ModalRegistry
  ? 'data' extends keyof ModalRegistry[TId]
    ? ModalRegistry[TId]['data']
    : void
  : unknown

export type ModalResult<TId extends ModalId> = TId extends keyof ModalRegistry
  ? 'result' extends keyof ModalRegistry[TId]
    ? ModalRegistry[TId]['result']
    : void
  : unknown

/**
 * Derives optional vs. required payload arguments based on `TData`.
 */
export type ModalDataArg<TData> = [TData] extends [never]
  ? []
  : [unknown] extends [TData]
  ? [data?: TData]
  : [TData] extends [void] | [undefined]
  ? [data?: TData]
  : undefined extends TData
  ? [data?: TData]
  : [data: TData]

export type ModalClose<TResult = void> = [TResult] extends [void]
  ? () => void
  : (result?: TResult) => void

/**
 * Standard props passed to registered modal components.
 */
export interface ModalProps<TData = unknown, TResult = void> {
  isOpen: boolean
  data: TData
  close: ModalClose<TResult>
}

export type ModalComponent<TData = unknown, TResult = void> = ComponentType<
  ModalProps<TData, TResult>
>

export type UntypedModalComponent = ComponentType<ModalProps<never, unknown>>

export type RegisteredComponent<TId extends ModalId> =
  [RegisteredModalId] extends [never]
    ? ComponentType<ModalProps<never, unknown>>
    : ModalComponent<ModalData<TId>, ModalResult<TId>>

export interface ModalRegistration<TId extends ModalId = ModalId> {
  id: TId
  component: RegisteredComponent<TId>
}

/**
 * Imperative modal controller returned by `useModal(id)`.
 */
export interface UseModalReturn<TData = unknown, TResult = unknown> {
  open(...args: ModalDataArg<TData>): Promise<TResult | undefined>
  close(result?: TResult): void
  isOpen(): boolean
}

export type CanonicalResult<TId extends ModalId, TResult = ModalResult<TId>> =
  [RegisteredModalId] extends [never] ? TResult : ModalResult<TId>

export interface ModalActionsValue {
  register<TId extends ModalId>(
    id: TId,
    component: RegisteredComponent<TId>
  ): void
  register(modals: readonly ModalRegistration[]): void
  unregister(idOrIds: ModalId | readonly ModalId[], targetComponent?: UntypedModalComponent): void
  open<TId extends ModalId, TResult = ModalResult<TId>>(
    id: TId,
    ...args: ModalDataArg<ModalData<TId>>
  ): Promise<CanonicalResult<TId, TResult> | undefined>
  close<TId extends ModalId>(id: TId, result?: ModalResult<TId>): void
  closeAll(): void
  isOpen(id: ModalId): boolean
}

export type ModalDefaultData =
  | Record<string, unknown>
  | ((id: ModalId) => unknown)

export type ModalRoutingStrategy = 'hash' | 'query'
export type ModalHistoryMode = 'push' | 'replace'

export interface ModalRoutingConfig {
  enabled?: boolean
  strategy?: ModalRoutingStrategy
  param?: string
  historyMode?: ModalHistoryMode
  defaultData?: ModalDefaultData
}

export interface ModalProviderProps {
  children: ReactNode
  unmountDelay?: number
  fallback?: ReactNode
  routing?: ModalRoutingConfig
}

interface ActiveModal {
  id: ModalId
  component: UntypedModalComponent
  isOpen: boolean
  data: unknown
  invocationId: number
}

const DEFAULT_ROUTING = {
  strategy: 'hash',
  param: 'modal',
  historyMode: 'push'
} as const

export const isBrowser = (): boolean => typeof window !== 'undefined'

const DEFAULT_UNMOUNT_DELAY = 200

const ModalActionsContext = createContext<ModalActionsValue | null>(null)
const ModalActiveContext = createContext<ReadonlyMap<ModalId, ActiveModal>>(new Map())

function isShallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags
  if (a instanceof Map || a instanceof Set || b instanceof Map || b instanceof Set) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  return keysA.every(
    k =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]
  )
}

function useStableRegistrations<T extends ModalId | readonly ModalRegistration[]>(
  idOrModals: T
): T {
  const ref = useRef(idOrModals)
  if (
    Array.isArray(idOrModals) &&
    Array.isArray(ref.current) &&
    ref.current.length === idOrModals.length &&
    ref.current.every((item, i) => item.id === idOrModals[i].id && item.component === idOrModals[i].component)
  ) {
    return ref.current as T
  }
  ref.current = idOrModals
  return idOrModals
}

function getHashParts(rawHash: string): { anchor: string; params: URLSearchParams } {
  const hash = rawHash.replace(/^#/, '')
  const [anchor, query] = hash.includes('?')
    ? hash.split('?', 2)
    : hash.includes('=')
    ? ['', hash]
    : [hash, '']
  return { anchor, params: new URLSearchParams(query) }
}

function formatHash(anchor: string, params: URLSearchParams): string {
  const qs = params.toString()
  return qs ? `#${anchor ? `${anchor}?` : ''}${qs}` : (anchor ? `#${anchor}` : '')
}

function getUrlModalId(config?: ModalRoutingConfig | null): string | null {
  if (!isBrowser() || !config || config.enabled === false) return null
  const param = config.param ?? DEFAULT_ROUTING.param
  return (config.strategy ?? DEFAULT_ROUTING.strategy) === 'query'
    ? new URLSearchParams(window.location.search).get(param)
    : getHashParts(window.location.hash).params.get(param)
}

function setUrlModalId(
  id: string | null,
  config?: ModalRoutingConfig | null,
  forceMode?: ModalHistoryMode
) {
  if (!isBrowser() || !config || config.enabled === false) return
  if (getUrlModalId(config) === id) return

  const mode = forceMode ?? config.historyMode ?? DEFAULT_ROUTING.historyMode
  const param = config.param ?? DEFAULT_ROUTING.param
  const url = new URL(window.location.href)
  const updateParams = (sp: URLSearchParams) => (id ? sp.set(param, id) : sp.delete(param))

  if ((config.strategy ?? DEFAULT_ROUTING.strategy) === 'query') {
    updateParams(url.searchParams)
  } else {
    const { anchor, params } = getHashParts(window.location.hash)
    updateParams(params)
    url.hash = formatHash(anchor, params)
  }

  window.history[mode === 'push' ? 'pushState' : 'replaceState'](
    window.history.state,
    '',
    url.pathname + url.search + url.hash
  )
}

function getDefaultData(defaultData: ModalDefaultData | undefined, id: ModalId): unknown {
  if (!defaultData) return undefined
  return typeof defaultData === 'function'
    ? defaultData(id)
    : Object.prototype.hasOwnProperty.call(defaultData, id)
    ? (defaultData as Record<string, unknown>)[id]
    : undefined
}

/**
 * Root provider hosting the modal registry, URL routing, lifecycle actions, and slot renderer.
 */
export function ModalProvider({
  children,
  unmountDelay = DEFAULT_UNMOUNT_DELAY,
  fallback = null,
  routing
}: ModalProviderProps) {
  // Registry stack allows multiple components to register the same modal ID safely
  const registryRef = useRef<Map<ModalId, UntypedModalComponent[]>>(new Map())

  // Active modals currently open or animating out
  const [activeModals, setActiveModals] = useState<ReadonlyMap<ModalId, ActiveModal>>(new Map())
  const activeModalsRef = useRef(activeModals)

  const updateActiveModals = useCallback(
    (updater: (prev: ReadonlyMap<ModalId, ActiveModal>) => ReadonlyMap<ModalId, ActiveModal>) => {
      const next = updater(activeModalsRef.current)
      activeModalsRef.current = next
      setActiveModals(next)
      return next
    },
    []
  )

  const pendingRef = useRef<
    Map<ModalId, { promise: Promise<unknown>; resolve: (value: unknown) => void; invocationId: number }>
  >(new Map())
  const timersRef = useRef<Map<ModalId, ReturnType<typeof setTimeout>>>(new Map())
  const invocationCounterRef = useRef(0)

  const resolvedRouting = useMemo(
    () =>
      routing
        ? {
            ...DEFAULT_ROUTING,
            ...routing,
            enabled: routing.enabled !== false
          }
        : null,
    [
      routing?.enabled,
      routing?.strategy,
      routing?.param,
      routing?.historyMode,
      routing?.defaultData
    ]
  )
  const routingRef = useRef(resolvedRouting)
  routingRef.current = resolvedRouting

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current.clear()
      pendingRef.current.forEach(p => p.resolve(undefined))
      pendingRef.current.clear()
    }
  }, [])

  const getComponent = useCallback((id: ModalId) => {
    const stack = registryRef.current.get(id)
    return stack?.[stack.length - 1]
  }, [])

  const scheduleUnmount = useCallback(
    (id: ModalId, invocationId: number) => {
      const existing = timersRef.current.get(id)
      if (existing) clearTimeout(existing)

      let timer: ReturnType<typeof setTimeout>
      timer = setTimeout(() => {
        if (timersRef.current.get(id) === timer) {
          timersRef.current.delete(id)
        }
        updateActiveModals(prev => {
          const item = prev.get(id)
          if (!item || item.isOpen || item.invocationId !== invocationId) return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      }, unmountDelay)
      timersRef.current.set(id, timer)
    },
    [unmountDelay, updateActiveModals]
  )

  const closeModal = useCallback(
    (id: ModalId, invocationId?: number, result?: unknown, syncUrl = true) => {
      const active = activeModalsRef.current.get(id)
      if (!active || !active.isOpen) return
      if (invocationId !== undefined && active.invocationId !== invocationId) return

      const pending = pendingRef.current.get(id)
      if (pending && (invocationId === undefined || pending.invocationId === invocationId)) {
        pendingRef.current.delete(id)
        pending.resolve(result)
      }

      if (syncUrl && routingRef.current?.enabled) {
        if (getUrlModalId(routingRef.current) === String(id)) {
          setUrlModalId(null, routingRef.current, 'replace')
        }
      }

      let didClose = false
      updateActiveModals(prev => {
        const current = prev.get(id)
        if (!current || !current.isOpen) return prev
        if (invocationId !== undefined && current.invocationId !== invocationId) return prev
        didClose = true
        const next = new Map(prev)
        if (unmountDelay <= 0) {
          next.delete(id)
        } else {
          next.set(id, { ...current, isOpen: false })
        }
        return next
      })

      if (didClose && unmountDelay > 0) {
        scheduleUnmount(id, active.invocationId)
      }
    },
    [scheduleUnmount, unmountDelay, updateActiveModals]
  )

  const openModal = useCallback(
    (id: ModalId, data?: unknown, syncUrl = true): Promise<unknown> => {
      const comp = getComponent(id)
      if (!comp) {
        return Promise.reject(
          new Error(`[react-modal-registry] Modal "${String(id)}" is not registered.`)
        )
      }

      const current = activeModalsRef.current.get(id)
      const existing = pendingRef.current.get(id)

      if (
        current?.isOpen &&
        current.component === comp &&
        isShallowEqual(current.data, data) &&
        existing
      ) {
        return existing.promise
      }

      if (syncUrl && routingRef.current?.enabled) {
        setUrlModalId(String(id), routingRef.current)
      }

      if (existing) {
        pendingRef.current.delete(id)
        existing.resolve(undefined)
      }

      const timer = timersRef.current.get(id)
      if (timer) {
        clearTimeout(timer)
        timersRef.current.delete(id)
      }

      const invocationId = ++invocationCounterRef.current
      let resolver!: (val: unknown) => void
      const promise = new Promise<unknown>(resolve => {
        resolver = resolve
      })

      pendingRef.current.set(id, { promise, resolve: resolver, invocationId })

      updateActiveModals(prev => {
        const next = new Map(prev)
        next.set(id, { id, component: comp, isOpen: true, data, invocationId })
        return next
      })

      return promise
    },
    [getComponent, updateActiveModals]
  )

  const open = useCallback(
    <TId extends ModalId, TResult = ModalResult<TId>>(
      id: TId,
      ...args: ModalDataArg<ModalData<TId>>
    ): Promise<CanonicalResult<TId, TResult> | undefined> => {
      return openModal(id, args[0], true) as Promise<CanonicalResult<TId, TResult> | undefined>
    },
    [openModal]
  )

  const close = useCallback(
    <TId extends ModalId>(id: TId, result?: ModalResult<TId>) => {
      closeModal(id, undefined, result, true)
    },
    [closeModal]
  )

  const closeAll = useCallback(() => {
    const pendings = Array.from(pendingRef.current.values())
    pendingRef.current.clear()

    if (routingRef.current?.enabled) {
      setUrlModalId(null, routingRef.current, 'replace')
    }

    if (unmountDelay <= 0) {
      for (const timer of timersRef.current.values()) clearTimeout(timer)
      timersRef.current.clear()
      updateActiveModals(() => new Map())
    } else {
      for (const [id, active] of activeModalsRef.current) {
        if (active.isOpen) {
          scheduleUnmount(id, active.invocationId)
        }
      }

      updateActiveModals(prev => {
        let changed = false
        const next = new Map(prev)
        for (const [id, active] of prev) {
          if (active.isOpen) {
            next.set(id, { ...active, isOpen: false })
            changed = true
          }
        }
        return changed ? next : prev
      })
    }

    pendings.forEach(p => p.resolve(undefined))
  }, [scheduleUnmount, unmountDelay, updateActiveModals])

  const isOpen = useCallback(
    (id: ModalId) => activeModalsRef.current.get(id)?.isOpen ?? false,
    []
  )

  const register: ModalActionsValue['register'] = useCallback(
    ((
      idOrModals: ModalId | readonly ModalRegistration[],
      component?: UntypedModalComponent
    ) => {
      const items: readonly { id: ModalId; component: UntypedModalComponent }[] =
        Array.isArray(idOrModals)
          ? (idOrModals as unknown as readonly { id: ModalId; component: UntypedModalComponent }[])
          : component
          ? [{ id: idOrModals as ModalId, component }]
          : []

      const urlId = routingRef.current?.enabled ? getUrlModalId(routingRef.current) : null

      for (const item of items) {
        let stack = registryRef.current.get(item.id)
        if (!stack) {
          stack = []
          registryRef.current.set(item.id, stack)
        }
        stack.push(item.component)

        // If URL routing is active and specifies this modal, open it immediately
        if (urlId && urlId === String(item.id) && !activeModalsRef.current.get(item.id)?.isOpen) {
          const data = getDefaultData(routingRef.current?.defaultData, item.id)
          openModal(item.id, data, false)
        }
      }
    }) as ModalActionsValue['register'],
    [openModal]
  )

  const unregister = useCallback(
    (idOrIds: ModalId | readonly ModalId[], targetComponent?: UntypedModalComponent) => {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds]

      for (const id of ids) {
        const stack = registryRef.current.get(id)
        if (!stack) continue

        if (targetComponent) {
          const idx = stack.lastIndexOf(targetComponent)
          if (idx !== -1) {
            stack.splice(idx, 1)
          }
          if (stack.length > 0) {
            continue
          }
        }

        registryRef.current.delete(id)

        const timer = timersRef.current.get(id)
        if (timer) {
          clearTimeout(timer)
          timersRef.current.delete(id)
        }

        const pending = pendingRef.current.get(id)
        if (pending) {
          pendingRef.current.delete(id)
          pending.resolve(undefined)
        }

        if (routingRef.current?.enabled && getUrlModalId(routingRef.current) === String(id)) {
          setUrlModalId(null, routingRef.current, 'replace')
        }

        updateActiveModals(prev => {
          if (!prev.has(id)) return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      }
    },
    [updateActiveModals]
  )

  // Two-way URL synchronization listener
  useEffect(() => {
    if (!resolvedRouting || !resolvedRouting.enabled || !isBrowser()) return

    const syncFromUrl = () => {
      const urlId = getUrlModalId(routingRef.current)
      const currentActive = activeModalsRef.current

      // Dismiss active modal that does not match urlId
      for (const [id, active] of currentActive) {
        if (String(id) !== urlId && active.isOpen) {
          closeModal(id, undefined, undefined, false)
        }
      }

      if (urlId) {
        const modalId = urlId as ModalId
        if (!currentActive.get(modalId)?.isOpen && getComponent(modalId)) {
          openModal(modalId, getDefaultData(routingRef.current?.defaultData, modalId), false)
        }
      }
    }

    syncFromUrl()

    window.addEventListener('popstate', syncFromUrl)
    window.addEventListener('hashchange', syncFromUrl)

    return () => {
      window.removeEventListener('popstate', syncFromUrl)
      window.removeEventListener('hashchange', syncFromUrl)
    }
  }, [
    resolvedRouting,
    getComponent,
    openModal,
    closeModal
  ])

  const actions = useMemo<ModalActionsValue>(
    () => ({
      register,
      unregister,
      open,
      close,
      closeAll,
      isOpen
    }),
    [register, unregister, open, close, closeAll, isOpen]
  )

  return (
    <ModalActionsContext.Provider value={actions}>
      <ModalActiveContext.Provider value={activeModals}>
        {children}
        <ModalRenderer
          activeModals={activeModals}
          close={closeModal}
          fallback={fallback}
        />
      </ModalActiveContext.Provider>
    </ModalActionsContext.Provider>
  )
}

function ModalRenderer({
  activeModals,
  close,
  fallback
}: {
  activeModals: ReadonlyMap<ModalId, ActiveModal>
  close: (id: ModalId, invocationId: number, result?: unknown, syncUrl?: boolean) => void
  fallback?: ReactNode
}) {
  if (activeModals.size === 0) return null

  return (
    <>
      {Array.from(activeModals.values(), active => (
        <ModalSlotItem
          key={`${String(active.id)}:${active.invocationId}`}
          active={active}
          onClose={close}
          fallback={fallback}
        />
      ))}
    </>
  )
}

const ModalSlotItem = memo(function ModalSlotItem({
  active,
  onClose,
  fallback
}: {
  active: ActiveModal
  onClose: (id: ModalId, invocationId: number, result?: unknown, syncUrl?: boolean) => void
  fallback?: ReactNode
}) {
  const handleClose = useCallback(
    (result?: unknown) => onClose(active.id, active.invocationId, result, true),
    [onClose, active.id, active.invocationId]
  )

  const Component = active.component

  return (
    <Suspense fallback={fallback ?? null}>
      <Component
        isOpen={active.isOpen}
        data={active.data as never}
        close={handleClose}
      />
    </Suspense>
  )
})

/**
 * Registers one or more modals for the lifetime of the calling component.
 */
export function useRegisterModal<TId extends ModalId>(
  id: TId,
  component: RegisteredComponent<TId>
): void
export function useRegisterModal<const TIds extends readonly ModalId[]>(modals: {
  [K in keyof TIds]: ModalRegistration<TIds[K]>
} | readonly ModalRegistration[]): void
export function useRegisterModal<TId extends ModalId>(
  idOrModals: TId | readonly ModalRegistration[],
  component?: RegisteredComponent<TId>
): void {
  const { register, unregister } = useModalContext()
  const stableIdOrModals = useStableRegistrations(idOrModals)

  useEffect(() => {
    if (Array.isArray(stableIdOrModals)) {
      register(stableIdOrModals)
      return () => {
        for (const item of stableIdOrModals) {
          unregister(item.id, item.component as unknown as UntypedModalComponent)
        }
      }
    }

    if (component) {
      register(stableIdOrModals as TId, component)
      return () => {
        unregister(stableIdOrModals as TId, component as unknown as UntypedModalComponent)
      }
    }

    return undefined
  }, [stableIdOrModals, component, register, unregister])
}

/**
 * Declarative component for mounting static modal batches at application roots.
 */
export function ModalRegistry<const TIds extends readonly ModalId[]>({
  modals
}: {
  modals: {
    [K in keyof TIds]: ModalRegistration<TIds[K]>
  } | readonly ModalRegistration[]
}) {
  useRegisterModal(modals)
  return null
}

/**
 * Returns typed controls (`open`, `close`, `isOpen`) for a modal ID.
 */
export function useModal<
  TId extends ModalId,
  TResult = ModalResult<TId>
>(
  id: TId
): UseModalReturn<ModalData<TId>, CanonicalResult<TId, TResult>> {
  const { open, close, isOpen } = useModalContext()

  return useMemo<UseModalReturn<ModalData<TId>, CanonicalResult<TId, TResult>>>(
    () => ({
      open: (...args: ModalDataArg<ModalData<TId>>) =>
        open<TId, TResult>(id, ...args),
      close: (result?: CanonicalResult<TId, TResult>) =>
        close(id, result as ModalResult<TId>),
      isOpen: () => isOpen(id)
    }),
    [open, close, isOpen, id]
  )
}

/**
 * Reactively subscribes to whether a modal is currently open.
 */
export function useIsModalOpen(id: ModalId): boolean {
  const active = useContext(ModalActiveContext)
  return active.get(id)?.isOpen ?? false
}

export function useCloseAll(): () => void {
  return useModalContext().closeAll
}

function useModalContext(): ModalActionsValue {
  const context = useContext(ModalActionsContext)
  if (!context) {
    throw new Error('useModalContext must be used within <ModalProvider>')
  }
  return context
}
