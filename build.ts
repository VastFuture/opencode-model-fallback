export {}

const result = await Bun.build({
	entrypoints: ["./index.ts", "./v1.ts"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	splitting: true,
	external: ["@opencode/plugin", "@opencode-ai/plugin", "@opencode-ai/sdk"],
})
if (!result.success) {
	console.error(result.logs)
	process.exit(1)
}

const proc = Bun.spawn(["tsc", "--emitDeclarationOnly", "--project", "tsconfig.json"])
const status = await proc.exited
if (status !== 0) process.exit(status)
