import * as os from "os";
import * as path from "path";
import { defineConfig } from "vitest/config";
// BUILDPILOT_OS_LOG: tests never open Terminal, touch the clipboard, open links or post Mac notifications (logged instead).
export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"], testTimeout: 20000, pool: "forks", env: { BUILDPILOT_OS_LOG: path.join(os.tmpdir(), `bp-test-os-${process.pid}.log`) } } });
