"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./Crm.module.css";

interface Toast {
  id: number;
  message: string;
  undo?: () => void | Promise<void>;
}

interface ToastApi {
  /** A short message at the bottom of the screen, with an Undo button if `undo` is given. */
  show: (message: string, undo?: () => void | Promise<void>) => void;
}

const SHOW_MS = 8000;

const Context = createContext<ToastApi | null>(null);

// Safe to call anywhere: outside a provider it simply says nothing.
export function useToast(): ToastApi {
  return useContext(Context) ?? { show: () => {} };
}

/** Class names for another look (the site app's own toast, 26 Nov 2026); the CRM's when left out. */
export interface ToastLook {
  list?: string;
  toast?: string;
  undo?: string;
  close?: string;
}

export function ToastProvider({ children, look }: { children: ReactNode; look?: ToastLook }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, undo?: () => void | Promise<void>) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { id, message, undo }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), SHOW_MS));
    },
    [dismiss]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <Context.Provider value={{ show }}>
      {children}
      <div className={look?.list ?? styles.toasts} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={look?.toast ?? styles.toast}>
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                className={look?.undo ?? styles.toastUndo}
                onClick={() => {
                  dismiss(toast.id);
                  void toast.undo?.();
                }}
              >
                Undo
              </button>
            )}
            <button type="button" className={look?.close ?? styles.toastClose} aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}
