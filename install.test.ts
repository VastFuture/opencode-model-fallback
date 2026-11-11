import { expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

for (const discoversDirectory of [false, true]) {
	test(`installer loads once when directory discovery is ${discoversDirectory}`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "fallback-install-"))
		try {
			const bin = join(directory, "bin")
			const config = join(directory, ".config/opencode")
			await mkdir(bin)
			await mkdir(join(config, "plugins"), { recursive: true })
			await mkdir(join(directory, "package"))
			await writeFile(join(directory, "package/package.json"), '{"name":"synthetic-plugin"}')
			const archive = join(directory, "plugin.tgz")
			const tar = Bun.spawn(["tar", "-czf", archive, "-C", directory, "package"])
			expect(await tar.exited).toBe(0)
			const scripts = {
				npm: "#!/bin/sh\nexit 0\n",
				curl: '#!/bin/sh\ncp "$INSTALL_TEST_ARCHIVE" "$4"\n',
				opencode: '#!/bin/sh\n[ "$INSTALL_TEST_DIRECTORY_DISCOVERY" = 1 ] || exit 1\nprintf "opencode-model-fallback local %s/.config/opencode/plugins/opencode-model-fallback\\n" "$HOME"\n',
			}
			for (const [name, source] of Object.entries(scripts)) {
				await writeFile(join(bin, name), source)
				await chmod(join(bin, name), 0o755)
			}
			const bridge = join(config, "plugins/opencode-model-fallback.js")
			await writeFile(bridge, "// previous installer bridge\n")
			const install = Bun.spawn(["bash", join(import.meta.dir, "install.sh")], {
				cwd: directory,
				env: {
					...process.env,
					HOME: directory,
					PATH: `${bin}:${process.env.PATH}`,
					INSTALL_TEST_ARCHIVE: archive,
					INSTALL_TEST_DIRECTORY_DISCOVERY: discoversDirectory ? "1" : "0",
				},
				stdout: "pipe",
				stderr: "pipe",
			})
			expect(await install.exited).toBe(0)
			expect(await Bun.file(join(config, "plugins/opencode-model-fallback/package.json")).exists()).toBe(true)
			expect(await Bun.file(bridge).exists()).toBe(!discoversDirectory)
			if (!discoversDirectory) expect(await Bun.file(bridge).text()).toContain('/dist/index.js"')
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
}
