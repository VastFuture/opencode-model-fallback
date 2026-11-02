import { mkdtemp, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directory = await mkdtemp(join(tmpdir(), "opencode-fallback-package-"))

try {
	const pack = Bun.spawn(["npm", "pack", "--silent", "--pack-destination", directory], {
		cwd: import.meta.dir,
		stdout: "pipe",
		stderr: "inherit",
	})
	const archive = (await new Response(pack.stdout).text()).trim()
	if ((await pack.exited) !== 0 || !archive) {
		throw new Error("Failed to pack plugin")
	}

	const install = Bun.spawn([
		"npm",
		"install",
		"--silent",
		"--ignore-scripts",
		"--legacy-peer-deps",
		"@opencode/plugin@2.2.5",
		join(directory, archive),
	], {
		cwd: directory,
		stdout: "inherit",
		stderr: "inherit",
	})
	if ((await install.exited) !== 0) {
		throw new Error("Failed to install packed plugin")
	}

	const resolve = createRequire(join(directory, "package.json")).resolve
	const entrypoint = resolve("opencode-runtime-fallback")
	const plugin = (await import(entrypoint)).default
	if (plugin?.id !== "opencode-model-fallback" || typeof plugin?.setup !== "function") {
		throw new Error("Packed default export is not an OpenCode V2 plugin definition")
	}
	if ("server" in plugin) {
		throw new Error("Packed V2 entrypoint unexpectedly exposes the V1 server hook")
	}

	const v1 = (await import(resolve("opencode-runtime-fallback/v1"))).default
	if (typeof v1 !== "function") {
		throw new Error("Packed V1 compatibility export is not a server hook factory")
	}
} finally {
	await rm(directory, { recursive: true, force: true })
}
