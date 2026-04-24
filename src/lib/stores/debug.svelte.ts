import type {
  ParamDef,
  PauseInfo,
  StackFrame,
  VarValue,
  DebugBreakpointRef,
} from "$lib/workspace";
import {
  debugOpenRpc,
  debugGetSourceRpc,
  debugStartRpc,
  debugStopRpc,
  debugStepIntoRpc,
  debugStepOverRpc,
  debugStepOutRpc,
  debugContinueRpc,
  debugRunRpc,
  debugGetValuesRpc,
  SESSION_LOST,
} from "$lib/workspace";

function extractBindNames(script: string): string[] {
  const bindPattern = /:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const seen = new Set<string>();
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = bindPattern.exec(script)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export type DebugStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "error";

export type BindVar = {
  name: string;
  oracleType: string;
  value: string;
  enabled: boolean;
};

export type LocalBreakpoint = {
  localId: number;
  owner: string;
  objectName: string;
  objectType: string;
  line: number;
};

class DebugStore {
  owner = $state("");
  objectName = $state("");
  objectType = $state("");
  packageName = $state<string | null>(null);
  memberList = $state<string[]>([]);

  script = $state("");
  params = $state<ParamDef[]>([]);
  bindVars = $state<BindVar[]>([]);

  breakpoints = $state<LocalBreakpoint[]>([]);
  private nextLocalBpId = 1;

  status = $state<DebugStatus>("idle");
  currentFrame = $state<StackFrame | null>(null);
  callStack = $state<StackFrame[]>([]);
  liveVars = $state<VarValue[]>([]);
  dbmsOutput = $state<string[]>([]);
  errorMessage = $state<string | null>(null);

  editorSource = $state("");
  editorObject = $state<{
    owner: string;
    objectName: string;
    objectType: string;
  } | null>(null);

  async open(
    owner: string,
    objectName: string,
    objectType: string,
    packageName: string | null,
  ) {
    this.owner = owner;
    this.objectName = objectName;
    this.objectType = objectType;
    this.packageName = packageName;
    this.status = "idle";
    this.currentFrame = null;
    this.liveVars = [];
    this.dbmsOutput = [];
    this.errorMessage = null;
    this.breakpoints = [];

    const res = await debugOpenRpc(
      owner,
      objectName,
      objectType,
      packageName ?? undefined,
    );
    if (!res.ok) {
      this.errorMessage = res.error.message;
      return;
    }
    this.script = res.data.script;
    this.params = res.data.params;
    this.memberList = res.data.memberList ?? [];
    this.bindVars = this._buildBindVars(res.data.script, res.data.params);

    const srcType =
      objectType.toUpperCase() === "PACKAGE" ? "PACKAGE BODY" : objectType;
    const srcRes = await debugGetSourceRpc(owner, objectName, srcType);
    if (srcRes.ok) {
      this.editorSource = srcRes.data.lines.join("");
      this.editorObject = { owner, objectName, objectType: srcType };
    } else {
      this.editorSource = this.script;
    }
  }

  private _buildBindVars(script: string, params: ParamDef[]): BindVar[] {
    const detected = extractBindNames(script);
    return detected.map((name) => {
      const param = params.find(
        (p) => p.name.toLowerCase() === name.toLowerCase(),
      );
      return {
        name,
        oracleType: param?.dataType ?? "VARCHAR2",
        value: "",
        enabled: true,
      };
    });
  }

  syncBindVars(newScript: string) {
    const detected = extractBindNames(newScript);
    const existing = new Map(this.bindVars.map((v) => [v.name, v]));
    this.bindVars = detected.map(
      (name) =>
        existing.get(name) ?? {
          name,
          oracleType: "VARCHAR2",
          value: "",
          enabled: true,
        },
    );
  }

  toggleBreakpoint(line: number) {
    const currentObj = this.editorObject;
    const idx = this.breakpoints.findIndex(
      (b) =>
        b.line === line &&
        b.objectName === (currentObj?.objectName ?? this.objectName),
    );
    if (idx >= 0) {
      this.breakpoints = this.breakpoints.filter((_, i) => i !== idx);
    } else {
      this.breakpoints = [
        ...this.breakpoints,
        {
          localId: this.nextLocalBpId++,
          owner: currentObj?.owner ?? this.owner,
          objectName: currentObj?.objectName ?? this.objectName,
          objectType: currentObj?.objectType ?? this.objectType,
          line,
        },
      ];
    }
  }

  hasBreakpoint(line: number): boolean {
    const currentObj = this.editorObject;
    return this.breakpoints.some(
      (b) =>
        b.line === line &&
        b.objectName === (currentObj?.objectName ?? this.objectName),
    );
  }

  private _buildBindsForExecution(): Record<string, unknown> {
    // TODO: wrap DATE binds with TO_DATE in the generated block
    const result: Record<string, unknown> = {};
    for (const v of this.bindVars) {
      if (!v.enabled) continue;
      result[v.name] = v.value === "" ? null : v.value;
    }
    return result;
  }

  async run() {
    this.status = "running";
    this.errorMessage = null;
    this.dbmsOutput = [];
    const res = await debugRunRpc({
      script: this.script,
      binds: this._buildBindsForExecution(),
    });
    if (res.ok) {
      this.dbmsOutput = res.data.output;
      this.status = "completed";
    } else {
      this.errorMessage = res.error.message;
      this.status = "error";
    }
  }

  async startDebug() {
    this.status = "running";
    this.errorMessage = null;
    this.dbmsOutput = [];
    this.currentFrame = null;

    const bpRefs: DebugBreakpointRef[] = this.breakpoints.map((b) => ({
      owner: b.owner,
      objectName: b.objectName,
      objectType: b.objectType,
      line: b.line,
    }));

    const res = await debugStartRpc({
      script: this.script,
      binds: this._buildBindsForExecution(),
      breakpoints: bpRefs,
    });

    if (!res.ok) {
      this.status = "error";
      this.errorMessage = res.error.message;
      if (res.error.code === SESSION_LOST) await this.stop();
      return;
    }

    await this._applyPauseInfo(res.data);
  }

  private async _applyPauseInfo(info: PauseInfo) {
    if (info.status === "completed") {
      this.status = "completed";
      this.currentFrame = null;
      return;
    }
    if (info.status === "error") {
      this.status = "error";
      this.errorMessage = info.errorMessage ?? "Unknown error";
      return;
    }
    this.status = "paused";
    this.currentFrame = info.frame;

    const varNames = this.bindVars.map((v) => v.name);
    if (varNames.length > 0) {
      const vals = await debugGetValuesRpc(varNames);
      if (vals.ok) this.liveVars = vals.data.variables;
    }

    if (info.frame && this.editorObject) {
      const f = info.frame;
      if (
        f.objectName !== this.editorObject.objectName ||
        f.owner !== this.editorObject.owner
      ) {
        const srcRes = await debugGetSourceRpc(
          f.owner,
          f.objectName,
          f.objectType,
        );
        if (srcRes.ok) {
          this.editorSource = srcRes.data.lines.join("");
          this.editorObject = {
            owner: f.owner,
            objectName: f.objectName,
            objectType: f.objectType,
          };
        }
      }
    }
  }

  async stepInto() {
    const res = await debugStepIntoRpc();
    if (!res.ok) {
      this.errorMessage = res.error.message;
      if (res.error.code === SESSION_LOST) await this.stop();
      return;
    }
    await this._applyPauseInfo(res.data);
  }

  async stepOver() {
    const res = await debugStepOverRpc();
    if (!res.ok) {
      this.errorMessage = res.error.message;
      if (res.error.code === SESSION_LOST) await this.stop();
      return;
    }
    await this._applyPauseInfo(res.data);
  }

  async stepOut() {
    const res = await debugStepOutRpc();
    if (!res.ok) {
      this.errorMessage = res.error.message;
      if (res.error.code === SESSION_LOST) await this.stop();
      return;
    }
    await this._applyPauseInfo(res.data);
  }

  async continue_() {
    const res = await debugContinueRpc();
    if (!res.ok) {
      this.errorMessage = res.error.message;
      if (res.error.code === SESSION_LOST) await this.stop();
      return;
    }
    await this._applyPauseInfo(res.data);
  }

  async stop() {
    await debugStopRpc();
    this.status = "idle";
    this.currentFrame = null;
    this.liveVars = [];
  }
}

export const debugStore = new DebugStore();
