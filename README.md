# react-modal-registry

> Type-safe, promise-based modal management and registration for React.

[![npm version](https://img.shields.io/npm/v/react-modal-registry?style=flat-square&color=black)](https://www.npmjs.com/package/react-modal-registry)
[![license](https://img.shields.io/badge/license-MIT-black?style=flat-square)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/react-modal-registry?style=flat-square&color=black)](https://bundlephobia.com/package/react-modal-registry)
[![typescript](https://img.shields.io/badge/TypeScript-strict-black?style=flat-square)](https://www.typescriptlang.org/)

---

## Installation

```bash
pnpm add react-modal-registry
# or
npm install react-modal-registry
# or
yarn add react-modal-registry
# or
bun add react-modal-registry
```

---

## Quick Start

### 1. Mount `ModalProvider`

Wrap your application root or layout shell:

```tsx
import { ModalProvider } from 'react-modal-registry'

export function RootLayout({ children }: { children: React.ReactNode }) {
  return <ModalProvider>{children}</ModalProvider>
}
```

### 2. Declare Modal Types

In an ambient declaration file (e.g., `env.d.ts` or `modals.d.ts`), augment `ModalDataMap` and `ModalResultMap`:

```ts
declare module 'react-modal-registry' {
  interface ModalDataMap {
    confirmDelete: { userId: string; name: string }
    barcodeScanner: { onScan: (code: string) => void }
  }

  interface ModalResultMap {
    confirmDelete: boolean
  }
}
```

### 3. Create a Modal Component

Write your modal as a standard React component using `ModalProps<TData, TResult>`:

```tsx
import type { ModalProps } from 'react-modal-registry'

export function ConfirmDeleteModal({
  isOpen,
  data,
  close
}: ModalProps<{ userId: string; name: string }, boolean>) {
  if (!isOpen) return null

  return (
    <dialog open={isOpen}>
      <h3>Delete {data.name}?</h3>
      <button onClick={() => close(true)}>Confirm</button>
      <button onClick={() => close(false)}>Cancel</button>
    </dialog>
  )
}
```

### 4. Register Modals

Mount registrations at layout or router boundaries:

```tsx
import { ModalRegistry } from 'react-modal-registry'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'

const appModals = [{ id: 'confirmDelete', component: ConfirmDeleteModal }] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModalRegistry modals={appModals} />
      {children}
    </>
  )
}
```

### 5. Trigger Anywhere with `useModal`

```tsx
import { useModal } from 'react-modal-registry'

export function DeleteButton({ user }: { user: { id: string; name: string } }) {
  const confirmModal = useModal('confirmDelete')

  const handleDelete = async () => {
    // Typed payload and strictly typed return value (Promise<boolean>)
    const confirmed = await confirmModal.open({
      userId: user.id,
      name: user.name
    })

    if (confirmed) {
      deleteUser(user.id)
    }
  }

  return <button onClick={handleDelete}>Delete User</button>
}
```

---

## Features

- **End-to-End Type Safety**: IDE autocompletion for modal IDs, payloads, and return types via TypeScript declaration merging.
- **Promise-Based & Event-Driven**: `await modal.open(data)` for async results or pass callbacks (`onScan`, `onSuccess`) directly in payloads.
- **Zero Re-Render Overhead**: Split-context architecture guarantees callers of `useModal()` never re-render when modals open, close, or animate.
- **Code-Splitting Ready**: Register modals with `React.lazy()` at app shells without importing modal components into caller files.
- **Lightweight & Headless**: Zero external runtime dependencies (~1.3 kB min+gzip). Works with any styling solution (Tailwind, Radix, Shadcn, MUI).

---

## Why react-modal-registry?

| Feature                      |                    `react-modal-registry`                     |   `@ebay/nice-modal-react`    |     `react-modal-promise`     |     `react-modal-hook`     |
| :--------------------------- | :-----------------------------------------------------------: | :---------------------------: | :---------------------------: | :------------------------: |
| **Type Safety**              | **Declaration merging** (autocompletes ID, payload, & return) |    String ID / loose types    |    Direct component import    |  Direct component import   |
| **Caller Re-renders**        |              **None** (isolated split contexts)               | Re-renders on context updates | Re-renders with wrapper state | Re-renders on state toggle |
| **Promise Returns**          |            **Strictly typed** (`Promise<TResult>`)            | Untyped (`Promise<unknown>`)  |        Manual generic         |       Not supported        |
| **Code Splitting**           |       **Native** (`React.lazy()` at registration shell)       |    Requires HOC per modal     |       Bundled at caller       |     Bundled at caller      |
| **Component Wrapper**        |               **None** (standard `ModalProps`)                | Requires `NiceModal.create()` |  Requires `create()` wrapper  |   Requires hook binding    |
| **UI Agnostic**              |              Yes (Tailwind, Radix, Shadcn, MUI)               |              Yes              |              Yes              |   Tied to `react-modal`    |
| **Bundle Size (min + gzip)** |                          **~1.3 kB**                          |            ~2.4 kB            |            ~1.6 kB            |          ~1.3 kB           |

---

## Patterns

### Local Component Registrations

Register modals scoped to the lifetime of a specific feature or page with `useRegisterModal`. Registrations unmount automatically when the caller unmounts:

```tsx
import { useRegisterModal } from 'react-modal-registry'
import { ReportModal } from './ReportModal'

export function AnalyticsPage() {
  useRegisterModal('customReport', ReportModal)

  return <main>Analytics Dashboard</main>
}
```

### Callback-Driven Workflows

Pass event listeners or streams directly in modal payload data:

```tsx
function ScannerTrigger() {
  const scanner = useModal('barcodeScanner')

  const handleScan = () => {
    scanner.open({
      onScan: code => console.log('Scanned:', code)
    })
  }

  return <button onClick={handleScan}>Scan Code</button>
}
```

### Reactive State Subscriptions

`useModal(id).isOpen()` reads state imperatively without re-rendering the caller. Use `useIsModalOpen(id)` when you need reactive UI updates:

```tsx
import { useIsModalOpen } from 'react-modal-registry'

function StatusIndicator() {
  const isOpen = useIsModalOpen('confirmDelete')
  return <span>{isOpen ? 'Active' : 'Idle'}</span>
}
```

---

## API Reference

| Export                            | Type      | Description                                                             |
| :-------------------------------- | :-------- | :---------------------------------------------------------------------- |
| `<ModalProvider>`                 | Component | Root provider managing modal lifecycle and rendering active slots.      |
| `<ModalRegistry>`                 | Component | Declarative component registering a batch of modals at root boundaries. |
| `useModal(id)`                    | Hook      | Returns typed imperative controls (`open`, `close`, `isOpen`).          |
| `useIsModalOpen(id)`              | Hook      | Reactively subscribes to the open status of a specific modal ID.        |
| `useRegisterModal(id, component)` | Hook      | Dynamically registers modals for the lifetime of the calling component. |
| `useCloseAll()`                   | Hook      | Dismisses all currently open modals.                                    |
| `ModalProps<TData, TResult>`      | Type      | Standard props received by registered modal components.                 |
| `ModalDataMap`                    | Interface | Augmentation interface for payload types.                               |
| `ModalResultMap`                  | Interface | Augmentation interface for return types.                                |
| `ModalRegistry`                   | Interface | Unified augmentation interface for paired data and result types.        |

---

## Architecture

- **Isolated Contexts**: Action dispatchers (`open`, `close`, `register`) are kept separate from slot rendering states. Invoking modal methods does not trigger re-renders in calling views.
- **Concurrent Requests**: Multiple concurrent invocations of `open()` with identical payloads reuse the active pending promise. Invoking `open()` with new parameters supersedes prior pending promises.

---

## License

[MIT](./LICENSE) © [Saurav Hathi](https://github.com/sauravhathi)
