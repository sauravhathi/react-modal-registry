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
 * Registry for modal payload types via module augmentation.
 *
 * @example
 * ```ts
 * declare module 'react-modal-registry' {
 *   interface ModalDataMap {
 *     confirmAction: { itemId: string }
 *   }
 * }
 * ```
 */
export interface ModalDataMap {}

/**
 * Registry for modal return types via module augmentation.
 *
 * @example
 * ```ts
 * declare module 'react-modal-registry' {
 *   interface ModalResultMap {
 *     confirmAction: boolean
 *   }
 * }
 * ```
 */
export interface ModalResultMap {}

/**
 * Registry for paired modal payload and return types via module augmentation.
 *
 * @example
 * ```ts
 * declare module 'react-modal-registry' {
 *   interface ModalRegistry {
 *     confirmAction: { data: { itemId: string }; result: boolean }
 *   }
 * }
 * ```
 */
export interface ModalRegistry {}

export type RegisteredModalId = keyof ModalDataMap | keyof ModalResultMap | keyof ModalRegistry

/**
 * Modal identifier supporting autocompletion of registered IDs with string fallback.
 */
export type ModalId = RegisteredModalId | (string & {})

export type ModalData<TId extends ModalId> = TId extends keyof ModalDataMap
  ? ModalDataMap[TId]
  : TId extends keyof ModalRegistry
    ? ModalRegistry[TId] extends { data: infer TData }
      ? TData
      : unknown
    : unknown

export type ModalResult<TId extends ModalId> = TId extends keyof ModalResultMap
  ? ModalResultMap[TId]
  : TId extends keyof ModalRegistry
    ? ModalRegistry[TId] extends { result: infer TResult }
      ? TResult
      : unknown
    : unknown

/**
 * optional vs required payload arguments based on `TData`.
 */
export type ModalDataArg<TData> = [unknown] extends [TData]
  ? [data?: TData]
  : [TData] extends [void] | [undefined]
    ? [data?: TData]
    : undefined extends TData
      ? [data?: TData]
      : [data: TData]

/**
 * Standard props passed to registered modal components.
 */
export interface ModalProps<TData = unknown, TResult = unknown> {
  isOpen: boolean
  data: TData
  close: (result?: TResult) => void
}

export type ModalComponent<TData = unknown, TResult = unknown> =
  | ComponentType<ModalProps<TData, TResult>>
  | ComponentType<ModalProps<TData, unknown>>

export interface ModalRegistration<TId extends ModalId = ModalId> {
  id: TId
  component: ModalComponent<ModalData<TId>, ModalResult<TId>>
}

/**
 * Imperative modal controller returned by `useModal(id)`.
 */
export interface UseModalReturn<TData = unknown, TResult = unknown> {
  /**
   * Opens the modal with the specified payload and resolves when closed.
   */
  open(...args: ModalDataArg<TData>): Promise<TResult>

  /**
   * Closes the modal imperatively, optionally passing a resolution value.
   */
  close(result?: TResult): void

  /**
   * Imperatively reads whether the modal is currently open.
   */
  isOpen(): boolean
}

interface ModalSlot {
  id: ModalId
  component: ComponentType<ModalProps<unknown, unknown>>
  isOpen: boolean
  isMounted: boolean
  data: unknown
}

interface ModalPending {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
}

export interface ModalActionsValue {
  register<TId extends ModalId>(
    id: TId,
    component: ModalComponent<ModalData<TId>, ModalResult<TId>>
  ): void
  register<const TIds extends readonly ModalId[]>(modals: {
    [K in keyof TIds]: ModalRegistration<TIds[K]>
  }): void
  unregister(idOrIds: ModalId | readonly ModalId[]): void
  open<TId extends ModalId, TResult = ModalResult<TId>>(
    id: TId,
    ...args: ModalDataArg<ModalData<TId>>
  ): Promise<TResult>
  close<TId extends ModalId>(id: TId, result?: ModalResult<TId>): void
  closeAll(): void
  isOpen(id: ModalId): boolean
}

const ModalActionsContext = createContext<ModalActionsValue | null>(null)
const ModalSlotsContext = createContext<ReadonlyMap<ModalId, ModalSlot> | null>(null)

// Allows exit animation transitions to complete before unmounting slot
const UNMOUNT_DELAY_MS = 200

/**
 * Root provider hosting the modal registry, lifecycle actions, and slot renderer.
 */
export function ModalProvider({ children }: { children: ReactNode }) {
  const slotsRef = useRef<Map<ModalId, ModalSlot>>(new Map())
  const pendingRef = useRef<Map<ModalId, ModalPending>>(new Map())
  const timersRef = useRef<Map<ModalId, ReturnType<typeof setTimeout>>>(new Map())
  const [slots, setSlots] = useState<ReadonlyMap<ModalId, ModalSlot>>(new Map())

  useEffect(() => {
    const timers = timersRef.current
    const pendings = pendingRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
      for (const pending of pendings.values()) {
        pending.resolve(undefined)
      }
      pendings.clear()
    }
  }, [])

  const sync = useCallback(() => {
    setSlots(new Map(slotsRef.current))
  }, [])

  const register: ModalActionsValue['register'] = useCallback(
    (
      idOrModals: ModalId | readonly ModalRegistration[],
      component?: ModalComponent<unknown, unknown>
    ) => {
      const items: readonly ModalRegistration[] = Array.isArray(idOrModals)
        ? idOrModals
        : component
          ? [
              {
                id: idOrModals,
                component: component as ModalComponent<unknown, unknown>
              }
            ]
          : []

      let changed = false
      for (const { id, component: comp } of items) {
        const existing = slotsRef.current.get(id)
        const typedComp = comp as ComponentType<ModalProps<unknown, unknown>>

        if (existing) {
          if (existing.component !== typedComp) {
            slotsRef.current.set(id, {
              ...existing,
              component: typedComp
            })
            changed = true
          }
        } else {
          slotsRef.current.set(id, {
            id,
            component: typedComp,
            isOpen: false,
            isMounted: false,
            data: undefined
          })
          changed = true
        }
      }

      if (changed) {
        sync()
      }
    },
    [sync]
  )

  const unregister = useCallback(
    (idOrIds: ModalId | readonly ModalId[]) => {
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds]
      let changed = false
      for (const id of ids) {
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
        if (slotsRef.current.has(id)) {
          slotsRef.current.delete(id)
          changed = true
        }
      }
      if (changed) {
        sync()
      }
    },
    [sync]
  )

  const open = useCallback(
    <TId extends ModalId, TResult = ModalResult<TId>>(
      id: TId,
      ...args: ModalDataArg<ModalData<TId>>
    ): Promise<TResult> => {
      const data = args[0] as ModalData<TId>
      const slot = slotsRef.current.get(id)

      if (!slot) {
        return Promise.reject(
          new Error(`[react-modal-registry] Modal "${String(id)}" is not registered.`)
        )
      }

      // Re-use active pending promise if open call is repeated with identical payload
      const existing = pendingRef.current.get(id)
      if (slot.isOpen && slot.data === data && existing) {
        return existing.promise as Promise<TResult>
      }

      // Supersede any pending promise before creating a new one
      if (existing) {
        pendingRef.current.delete(id)
        existing.resolve(undefined)
      }

      const timer = timersRef.current.get(id)
      if (timer) {
        clearTimeout(timer)
        timersRef.current.delete(id)
      }

      let resolver!: (value: unknown) => void
      const promise = new Promise<TResult>(resolve => {
        resolver = resolve as (value: unknown) => void
      })

      pendingRef.current.set(id, {
        promise: promise as Promise<unknown>,
        resolve: resolver
      })

      slotsRef.current.set(id, { ...slot, isOpen: true, isMounted: true, data })
      sync()

      return promise
    },
    [sync]
  )

  const scheduleUnmount = useCallback(
    (id: ModalId) => {
      const timer = timersRef.current.get(id)
      if (timer) clearTimeout(timer)

      timersRef.current.set(
        id,
        setTimeout(() => {
          timersRef.current.delete(id)
          const current = slotsRef.current.get(id)
          if (current && !current.isOpen) {
            slotsRef.current.set(id, { ...current, isMounted: false })
            sync()
          }
        }, UNMOUNT_DELAY_MS)
      )
    },
    [sync]
  )

  const close = useCallback(
    <TId extends ModalId>(id: TId, result?: ModalResult<TId>) => {
      const slot = slotsRef.current.get(id)
      if (!slot || !slot.isOpen) return

      const pending = pendingRef.current.get(id)
      if (pending) {
        pendingRef.current.delete(id)
        pending.resolve(result)
      }

      slotsRef.current.set(id, { ...slot, isOpen: false, isMounted: true })
      sync()
      scheduleUnmount(id)
    },
    [sync, scheduleUnmount]
  )

  const closeAll = useCallback(() => {
    for (const [, pending] of pendingRef.current) {
      pending.resolve(undefined)
    }
    pendingRef.current.clear()

    let changed = false
    for (const [id, slot] of slotsRef.current) {
      if (slot.isOpen) {
        slotsRef.current.set(id, { ...slot, isOpen: false, isMounted: true })
        scheduleUnmount(id)
        changed = true
      }
    }

    if (changed) {
      sync()
    }
  }, [sync, scheduleUnmount])

  const isOpen = useCallback((id: ModalId) => slotsRef.current.get(id)?.isOpen ?? false, [])

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
      <ModalSlotsContext.Provider value={slots}>
        {children}
        <ModalRenderer />
      </ModalSlotsContext.Provider>
    </ModalActionsContext.Provider>
  )
}

/**
 * Registers one or more modals for the lifetime of the calling component.
 *
 */
export function useRegisterModal<TId extends ModalId>(
  id: TId,
  component: ModalComponent<ModalData<TId>, ModalResult<TId>>
): void
export function useRegisterModal<const TIds extends readonly ModalId[]>(modals: {
  [K in keyof TIds]: ModalRegistration<TIds[K]>
}): void
export function useRegisterModal<TId extends ModalId>(
  idOrModals:
    | TId
    | readonly {
        id: ModalId
        component: ComponentType<ModalProps<unknown, unknown>>
      }[],
  component?: ModalComponent<ModalData<TId>, ModalResult<TId>>
): void {
  const { register, unregister } = useModalContext()

  useEffect(() => {
    if (Array.isArray(idOrModals)) {
      register(idOrModals as Parameters<typeof register>[0])
      return () => {
        unregister(idOrModals.map(m => m.id))
      }
    }

    if (component) {
      register(idOrModals as TId, component)
      return () => {
        unregister(idOrModals as TId)
      }
    }

    return undefined
  }, [idOrModals, component, register, unregister])
}

/**
 * Declarative component for mounting static modal batches at application or layout roots.
 */
export function ModalRegistry<const TIds extends readonly ModalId[]>({
  modals
}: {
  modals: {
    [K in keyof TIds]: ModalRegistration<TIds[K]>
  }
}) {
  useRegisterModal(modals)
  return null
}

/**
 * Returns typed controls (`open`, `close`, `isOpen`) for a modal ID.
 *
 * `isOpen()` reads state imperatively without subscribing the caller to render updates.
 * Use `useIsModalOpen(id)` for reactive subscriptions.
 *
 * @example
 * ```tsx
 * function DeleteButton({ id }: { id: string }) {
 *   const confirmModal = useModal('confirmation')
 *
 *   const handleDelete = async () => {
 *     const confirmed = await confirmModal.open({ itemId: id })
 *     if (confirmed) {
 *       deleteItem(id)
 *     }
 *   }
 *
 *   return <button onClick={handleDelete}>Delete</button>
 * }
 * ```
 */
export function useModal<TId extends ModalId, TResult = ModalResult<TId>>(
  id: TId
): UseModalReturn<ModalData<TId>, TResult> {
  const { open, close, isOpen } = useModalContext()

  return useMemo<UseModalReturn<ModalData<TId>, TResult>>(
    () => ({
      open: (...args: ModalDataArg<ModalData<TId>>) => open<TId, TResult>(id, ...args),
      close: (result?: TResult) => close(id, result as ModalResult<TId>),
      isOpen: () => isOpen(id)
    }),
    [open, close, isOpen, id]
  )
}

/**
 * Reactively subscribes to whether a modal is currently open.
 */
export function useIsModalOpen(id: ModalId): boolean {
  const slots = useContext(ModalSlotsContext)

  if (!slots) {
    throw new Error('useIsModalOpen must be used within <ModalProvider>')
  }

  return slots.get(id)?.isOpen ?? false
}

export function useCloseAll(): () => void {
  return useModalContext().closeAll
}

const ModalSlotItem = memo(function ModalSlotItem({
  id,
  component: Component,
  isOpen,
  data,
  close
}: {
  id: ModalId
  component: ComponentType<ModalProps<unknown, unknown>>
  isOpen: boolean
  data: unknown
  close: (id: ModalId, result?: unknown) => void
}) {
  const handleClose = useCallback(
    (result?: unknown) => {
      close(id, result)
    },
    [close, id]
  )

  return (
    <Suspense fallback={null}>
      <Component isOpen={isOpen} data={data} close={handleClose} />
    </Suspense>
  )
})

function ModalRenderer() {
  const slots = useContext(ModalSlotsContext)
  const { close } = useModalContext()

  if (!slots) {
    return null
  }

  return (
    <>
      {Array.from(slots.values()).map(slot =>
        slot.isMounted ? (
          <ModalSlotItem
            key={slot.id}
            id={slot.id}
            component={slot.component}
            isOpen={slot.isOpen}
            data={slot.data}
            close={close}
          />
        ) : null
      )}
    </>
  )
}

function useModalContext(): ModalActionsValue {
  const context = useContext(ModalActionsContext)

  if (!context) {
    throw new Error('useModalContext must be used within <ModalProvider>')
  }

  return context
}
