"use client";

import { Component, type ReactNode } from "react";

import styles from "./Todo.module.css";

/**
 * A part of the app that can't open says so in its own place, and the rest of the app carries on: the bar, the roll call
 * (27 Nov 2026: with no signal, a part whose code the phone hasn't kept yet can't load; without this the whole app
 * showed "This page couldn't load").
 */
export class PartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.banner} role="alert">
        This part couldn&rsquo;t open. With no signal, it opens once the phone has had signal with the app open.{" "}
        <button type="button" className={styles.bannerLink} onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
}
