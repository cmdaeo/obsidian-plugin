import fs from "fs";
import * as git from "isomorphic-git";
import path from "path";

async function run() {
  const dir = "C:/Users/Miguel/Documents/Obsidian Vault";
  try {
    const isRepo = fs.existsSync(path.join(dir, ".git"));
    if (!isRepo) {
      console.log("Vault is not a repo.");
      return;
    }

    const current = await git.currentBranch({ fs, dir });
    const localOid = await git.resolveRef({ fs, dir, ref: "HEAD" }).catch(() => null);
    const remoteOid = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${current}` }).catch(() => null);

    console.log("Local HEAD:", localOid);
    console.log("Remote HEAD:", remoteOid);

    if (localOid && remoteOid) {
      const mergeBases = await git.findMergeBase({ fs, dir, oids: [localOid, remoteOid] });
      const baseOid = mergeBases[0];
      console.log("Base OID:", baseOid);

      const localCommits = await git.log({ fs, dir, ref: "HEAD" });
      const remoteCommits = await git.log({ fs, dir, ref: `refs/remotes/origin/${current}` });

      const ahead = localCommits.findIndex(c => c.oid === baseOid);
      const behind = remoteCommits.findIndex(c => c.oid === baseOid);

      console.log(`Ahead by ${ahead}, behind by ${behind}`);
      
      const conflicts = [];
      await git.walk({
        fs, dir,
        trees: [git.TREE({ ref: baseOid }), git.TREE({ ref: localOid }), git.TREE({ ref: remoteOid })],
        map: async function(filepath, [base, local, remote]) {
          if (!local && !remote) return; // deleted in both
          if (filepath === ".") return; // root
          
          const lOid = local ? await local.oid() : null;
          const rOid = remote ? await remote.oid() : null;
          const bOid = base ? await base.oid() : null;
          
          if (lOid !== rOid && lOid !== bOid && rOid !== bOid) {
             console.log(`Conflict in ${filepath}: Base(${bOid}), Local(${lOid}), Remote(${rOid})`);
             conflicts.push(filepath);
          }
        }
      });
    }

  } catch (e) {
    console.error(e);
  }
}

run();
