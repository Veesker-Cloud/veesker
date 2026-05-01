#!/usr/bin/env bun
import { Command } from "commander";
import { registerInfo } from "./commands/info";
import { registerCreate } from "./commands/create";
import { registerQuery } from "./commands/query";
import { registerKeypair } from "./commands/keypair";
import { registerEncrypt } from "./commands/encrypt";
import { registerDecrypt } from "./commands/decrypt";

const program = new Command();
program
  .name("vsk-engine")
  .description("VeeskerDB — Oracle-compatible analytical engine")
  .version("0.1.0");

registerInfo(program);
registerCreate(program);
registerQuery(program);
registerKeypair(program);
registerEncrypt(program);
registerDecrypt(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(`error: ${(err as Error).message}`);
  process.exit(1);
});
