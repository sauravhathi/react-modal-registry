# react-modal-registry

> Type-safe, promise-based modal and dialog management for React.

[![npm version](https://img.shields.io/npm/v/react-modal-registry?style=flat-square&color=black)](https://www.npmjs.com/package/react-modal-registry)
[![license](https://img.shields.io/badge/license-MIT-black?style=flat-square)](./LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/react-modal-registry?style=flat-square&color=black)](https://bundlephobia.com/package/react-modal-registry)
[![typescript](https://img.shields.io/badge/TypeScript-strict-black?style=flat-square)](https://www.typescriptlang.org/)

Managing dialogs in React often leads to **modal sprawl**—scattering `useState(false)` flags, prop drilling, and duplicate dialog components across pages.

`react-modal-registry` provides a single, type-safe registry to open and manage modals cleanly:

- **Promise-Based Dialogs**: Open modals imperatively (`await modal.open()`) and await user responses inline without local boolean states.
- **End-to-End Type Safety**: Autocomplete modal IDs, input payloads, and return values via TypeScript declaration merging.
- **URL Deep-Linking**: Synchronize modal visibility with the URL hash (`#modal=<id>`) or query params with native browser Back button dismissal.
- **Zero Re-Render Penalty**: Split-context architecture ensures caller components never re-render when modals open or close.
- **Headless & UI Agnostic**: Works out of the box with shadcn/ui, Radix UI, Tailwind CSS, or native HTML `<dialog>`.

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

Wrap your application root:

```tsx
import { ModalProvider } from 'react-modal-registry'

export function App({ children }: { children: React.ReactNode }) {
  return <ModalProvider>{children}</ModalProvider>
}
```

### 2. Declare Modal Types

Declare modal IDs, payloads, and return types via TypeScript module augmentation (e.g., `env.d.ts` or `modals.d.ts`):

```ts
declare module 'react-modal-registry' {
  interface ModalRegistry {
    confirmDelete: {
      data: { name: string }
      result: boolean
    }
  }
}
```

### 3. Create a Modal Component

Use `ModalProps<TData, TResult>` for your component props:

```tsx
import type { ModalProps } from 'react-modal-registry'

export function ConfirmDeleteModal({
  isOpen,
  data,
  close
}: ModalProps<{ name: string }, boolean>) {
  if (!isOpen) return null

  return (
    <dialog open={isOpen}>
      <p>Are you sure you want to delete {data.name}?</p>
      <button onClick={() => close(true)}>Delete</button>
      <button onClick={() => close(false)}>Cancel</button>
    </dialog>
  )
}
```

### 4. Register and Open

Register modals at app root or feature level, and trigger them anywhere with `useModal`:

```tsx
import { ModalRegistry, useModal } from 'react-modal-registry'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'

const modals = [{ id: 'confirmDelete', component: ConfirmDeleteModal }] as const

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ModalRegistry modals={modals} />
      {children}
    </>
  )
}

export function DeleteButton({ itemName }: { itemName: string }) {
  const confirmModal = useModal('confirmDelete')

  const handleDelete = async () => {
    const confirmed = await confirmModal.open({ name: itemName })
    if (confirmed) {
      // item deleted
    }
  }

  return <button onClick={handleDelete}>Delete</button>
}
```

---

## Usage & Features

### Promise-Based Responses

`modal.open(data)` returns a `Promise<TResult | undefined>`. Calling `close(result)` resolves the promise:

```tsx
const confirmed = await modal.open({ name: 'Project Alpha' })
if (confirmed) {
  await api.deleteProject()
}
```

If the modal is dismissed without a value (e.g. backdrop click or ESC), the promise resolves to `undefined`.

### Rich Payloads & Callbacks

Pay-load data is passed in-memory, so you can pass callbacks, functions, or complex objects directly:

```ts
declare module 'react-modal-registry' {
  interface ModalRegistry {
    scanner: {
      data: { onScan: (code: string) => void }
    }
  }
}
```

```tsx
const scannerModal = useModal('scanner')

scannerModal.open({
  onScan: code => {
    console.log('Scanned:', code)
  }
})
```

### Component-Scoped Registrations

Register modals that exist only while a specific component is mounted:

```tsx
import { useRegisterModal, useModal } from 'react-modal-registry'
import { FeatureModal } from './FeatureModal'

export function FeaturePage() {
  useRegisterModal('featureDetails', FeatureModal)
  const modal = useModal('featureDetails')

  return <button onClick={() => modal.open()}>Open Details</button>
}
```

### Code Splitting with `React.lazy`

Split modal components into separate chunks:

```tsx
import { lazy } from 'react'
import { ModalRegistry } from 'react-modal-registry'

const AnalyticsModal = lazy(() => import('./AnalyticsModal'))

const modals = [{ id: 'analytics', component: AnalyticsModal }] as const

export function App() {
  return <ModalRegistry modals={modals} />
}
```

### URL Deep Linking

Optionally sync active modals with the browser URL (hash or query) and browser Back button:

```tsx
<ModalProvider
  routing={{
    strategy: 'hash', // 'hash' (#modal=changelog) or 'query' (?modal=changelog)
    param: 'modal', // default: 'modal'
    historyMode: 'push', // 'push' or 'replace'
    defaultData: {
      changelog: { version: '1.0.0' }
    }
  }}
>
  {children}
</ModalProvider>
```

When routing is enabled:
- Opening a modal syncs `#modal=<id>` to the URL.
- Closing the modal cleans up the URL parameter.
- Pressing the browser **Back** button dismisses the modal.

---

## API Reference

| Export | Type | Description |
| :--- | :--- | :--- |
| `<ModalProvider>` | Component | Root provider managing modal state and slot rendering. Accepts `unmountDelay`, `fallback`, and `routing`. |
| `<ModalRegistry>` | Component | Mounts a batch of static modal registrations: `<ModalRegistry modals={[...]} />`. |
| `useModal(id)` | Hook | Returns imperative controls: `{ open(data?), close(result?), isOpen() }`. |
| `useIsModalOpen(id)` | Hook | Reactively subscribes to whether a modal is currently open (`boolean`). |
| `useRegisterModal(id, component)` | Hook | Dynamically registers a modal for the calling component's lifecycle. |
| `useCloseAll()` | Hook | Dismisses all currently open modals. |
| `ModalProps<TData, TResult>` | Interface | Props received by modal components: `{ isOpen, data, close }`. |
| `ModalRegistry` | Interface | Target interface for module augmentation. |

---

## Interactive Demo

A runnable demo showcasing forms, wizards, drawers, and deep linking is available in the [`demo`](./demo) directory:

```bash
cd demo
pnpm install
pnpm dev
```

---

## License

[MIT](./LICENSE) © [Saurav Hathi](https://github.com/sauravhathi)
