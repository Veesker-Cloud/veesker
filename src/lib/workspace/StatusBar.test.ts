import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import StatusBar from "./StatusBar.svelte";
import { sqlEditor } from "$lib/stores/sql-editor.svelte";

beforeEach(() => sqlEditor.reset());

const baseProps = {
  connectionName: "Oracle Free",
  userLabel: "SYSTEM @ localhost:1521/FREEPDB1",
  schema: "SYSTEM",
  serverVersion: "Oracle 23.26",
  onDisconnect: () => {},
  onSwitchConnection: () => {},
};

describe("StatusBar SQL toggle", () => {
  it("renders SQL toggle button", () => {
    render(StatusBar, { props: baseProps });
    expect(screen.getByRole("button", { name: /toggle sql drawer/i })).toBeInTheDocument();
  });

  it("clicking the toggle flips drawerOpen", async () => {
    render(StatusBar, { props: baseProps });
    const btn = screen.getByRole("button", { name: /toggle sql drawer/i });
    expect(sqlEditor.drawerOpen).toBe(false);
    await fireEvent.click(btn);
    expect(sqlEditor.drawerOpen).toBe(true);
  });

  it("toggle has active class when drawerOpen is true", async () => {
    render(StatusBar, { props: baseProps });
    const btn = screen.getByRole("button", { name: /toggle sql drawer/i });
    sqlEditor.toggleDrawer();
    await new Promise((r) => setTimeout(r, 0));
    expect(btn.className).toMatch(/active/);
  });
});
