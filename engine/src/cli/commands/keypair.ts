import type { Command } from "commander";
import {
  generateKeypair,
  publicKeyFromPrivate,
  pubkeyToBase64,
} from "../../crypto/keypair";
import { OsKeyringStore } from "../../crypto/keystore";
import { sodiumReady } from "../../crypto/sodium";

const SERVICE = "veesker-engine";

/**
 * Register the `keypair` subcommand group: `init`, `show`, `delete`.
 *
 * Each subcommand requires `--account <id>` — the stable identifier for
 * the user (typically email). The X25519 private key is stored in the
 * OS credential manager under service `"veesker-engine"`.
 */
export function registerKeypair(program: Command): void {
  const kp = program
    .command("keypair")
    .description("manage VeeskerDB user X25519 keypair");

  kp.command("init")
    .description("generate a new keypair and store the private key in the OS keyring")
    .requiredOption("--account <id>", "account identifier (typically your email)")
    .option("--force", "overwrite an existing key")
    .action(async (opts: { account: string; force?: boolean }) => {
      const store = new OsKeyringStore(SERVICE, opts.account);
      const existing = await store.getPrivateKey();
      if (existing && !opts.force) {
        throw new Error(
          `keypair already exists for ${opts.account}; pass --force to overwrite`,
        );
      }
      const generated = await generateKeypair();
      await store.setPrivateKey(generated.privateKey);
      console.log(`keypair stored for ${opts.account}`);
      console.log(`pubkey: ${pubkeyToBase64(generated.publicKey)}`);
    });

  kp.command("show")
    .description("print the public key for an account")
    .requiredOption("--account <id>", "account identifier")
    .action(async (opts: { account: string }) => {
      const store = new OsKeyringStore(SERVICE, opts.account);
      const priv = await store.getPrivateKey();
      if (!priv) {
        throw new Error(`no keypair for ${opts.account}`);
      }
      await sodiumReady();
      const pub = publicKeyFromPrivate(priv);
      console.log(pubkeyToBase64(pub));
    });

  kp.command("delete")
    .description("delete a keypair from the OS keyring")
    .requiredOption("--account <id>", "account identifier")
    .action(async (opts: { account: string }) => {
      const store = new OsKeyringStore(SERVICE, opts.account);
      await store.deletePrivateKey();
      console.log(`keypair deleted for ${opts.account}`);
    });
}
