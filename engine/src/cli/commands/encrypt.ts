import type { Command } from "commander";
import { DuckDBHost } from "../../duckdb-host";
import { readVsk } from "../../vsk-format/reader";
import { writeEncryptedVsk } from "../../vsk-format/writer";
import { OsKeyringStore } from "../../crypto/keystore";
import {
  publicKeyFromPrivate,
  pubkeyFromBase64,
} from "../../crypto/keypair";
import { randomKey } from "../../crypto/blob";
import { sealEnvelope } from "../../crypto/envelope";
import { sodiumReady } from "../../crypto/sodium";

const SERVICE = "veesker-engine";

export function registerEncrypt(program: Command): void {
  program
    .command("encrypt")
    .description("encrypt a plain .vsk for a recipient pubkey")
    .requiredOption("--in <path>", "plain .vsk path")
    .requiredOption("--out <path>", "encrypted .vsk path")
    .requiredOption("--account <id>", "your account (sender)")
    .requiredOption(
      "--recipient <b64pubkey>",
      "recipient public key (base64, 44 chars)",
    )
    .action(
      async (opts: {
        in: string;
        out: string;
        account: string;
        recipient: string;
      }) => {
        await sodiumReady();
        const store = new OsKeyringStore(SERVICE, opts.account);
        const senderPriv = await store.getPrivateKey();
        if (!senderPriv) {
          throw new Error(`no keypair for ${opts.account}`);
        }
        const senderPub = publicKeyFromPrivate(senderPriv);
        const recipientPub = pubkeyFromBase64(opts.recipient);

        const src = await DuckDBHost.openInMemory();
        try {
          const manifest = await readVsk(opts.in, src);
          const contentKey = randomKey();
          const envelope = await sealEnvelope(contentKey, recipientPub, {
            publicKey: senderPub,
            privateKey: senderPriv,
          });
          await writeEncryptedVsk(src, opts.out, manifest, contentKey, envelope);
          console.log(`encrypted ${opts.in} → ${opts.out}`);
        } finally {
          await src.close();
        }
      },
    );
}
