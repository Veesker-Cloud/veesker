import type { Command } from "commander";
import { DuckDBHost } from "../../duckdb-host";
import { readEncryptedVsk } from "../../vsk-format/reader";
import { writeVsk } from "../../vsk-format/writer";
import { OsKeyringStore } from "../../crypto/keystore";
import {
  publicKeyFromPrivate,
  pubkeyFromBase64,
} from "../../crypto/keypair";
import { sodiumReady } from "../../crypto/sodium";

const SERVICE = "veesker-engine";

export function registerDecrypt(program: Command): void {
  program
    .command("decrypt")
    .description("decrypt an encrypted .vsk into a plain .vsk")
    .requiredOption("--in <path>", "encrypted .vsk path")
    .requiredOption("--out <path>", "decrypted .vsk path")
    .requiredOption("--account <id>", "your account (recipient)")
    .requiredOption(
      "--sender <b64pubkey>",
      "sender public key (base64, 44 chars)",
    )
    .action(
      async (opts: {
        in: string;
        out: string;
        account: string;
        sender: string;
      }) => {
        await sodiumReady();
        const store = new OsKeyringStore(SERVICE, opts.account);
        const priv = await store.getPrivateKey();
        if (!priv) {
          throw new Error(`no keypair for ${opts.account}`);
        }
        const pub = publicKeyFromPrivate(priv);

        const dst = await DuckDBHost.openInMemory();
        try {
          const manifest = await readEncryptedVsk(
            opts.in,
            dst,
            pubkeyFromBase64(opts.sender),
            { publicKey: pub, privateKey: priv },
          );
          await writeVsk(dst, opts.out, manifest);
          console.log(`decrypted ${opts.in} → ${opts.out}`);
        } finally {
          await dst.close();
        }
      },
    );
}
