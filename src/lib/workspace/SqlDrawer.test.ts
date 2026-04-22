import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import SqlDrawer from "./SqlDrawer.svelte";
import { sqlEditor } from "$lib/stores/sql-editor.svelte";

beforeEach(() => sqlEditor.reset());

describe("SqlDrawer", () => {
  it("renders collapsed strip when drawerOpen is false", () => {
    render(SqlDrawer);
    expect(screen.getByText(/^SQL$/)).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("renders tabs when expanded", () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    render(SqlDrawer);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.length).toBe(2);
    expect(tabs[0]).toHaveTextContent("Query 1");
    expect(tabs[1]).toHaveTextContent("Query 2");
  });

  it("clicking a tab makes it active", async () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    render(SqlDrawer);
    const firstId = sqlEditor.tabs[0].id;
    const firstTabBtn = screen.getAllByRole("tab")[0];
    await fireEvent.click(firstTabBtn);
    expect(sqlEditor.activeId).toBe(firstId);
  });

  it("clicking + opens a new tab", async () => {
    sqlEditor.toggleDrawer(); // open drawer manually
    render(SqlDrawer);
    // The tab bar "+" button is the first "New query" button; the toolbar also has one
    const [plus] = screen.getAllByRole("button", { name: /new query/i });
    await fireEvent.click(plus);
    expect(sqlEditor.tabs.length).toBe(1);
    expect(sqlEditor.tabs[0].title).toBe("Query 1");
  });

  it("clicking × on a tab closes it", async () => {
    sqlEditor.openBlank();
    sqlEditor.openBlank();
    render(SqlDrawer);
    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    await fireEvent.click(closeButtons[0]);
    expect(sqlEditor.tabs.length).toBe(1);
  });

  it("collapse button toggles drawerOpen", async () => {
    sqlEditor.openBlank();
    render(SqlDrawer);
    const collapse = screen.getByRole("button", { name: /collapse/i });
    await fireEvent.click(collapse);
    expect(sqlEditor.drawerOpen).toBe(false);
  });

  it("clicking the collapsed strip expands the drawer", async () => {
    render(SqlDrawer);
    const strip = screen.getByRole("button", { name: /expand sql/i });
    await fireEvent.click(strip);
    expect(sqlEditor.drawerOpen).toBe(true);
  });

  it("shows empty state when drawerOpen but no tabs", () => {
    sqlEditor.toggleDrawer();
    render(SqlDrawer);
    expect(screen.getByText(/click \+ to open a new query/i)).toBeInTheDocument();
  });
});
