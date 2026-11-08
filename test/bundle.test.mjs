import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createBuildOptions, createWebviewScriptBuildOptions } from '@bwat47/joplin-plugin-scripts';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Builds `options` in memory and returns the bundle text. */
async function bundle(options) {
    const result = await build({ ...options, write: false, logLevel: 'silent' });
    return result.outputFiles[0].text;
}

test('the calendar dialog script loads as a plain script without module, exports, or require', async () => {
    const text = await bundle(createWebviewScriptBuildOptions(root, 'calendar/calendar.ts'));
    // A dialog <script> has globals only. Without `document`, the script skips initialization,
    // so this checks that loading the bundle itself needs no CommonJS bindings.
    // eslint-disable-next-line sonarjs/code-eval -- Executes only the bundle built from this repository.
    assert.doesNotThrow(() => runInNewContext(text, { console }));
});

test('the production bundle registers with Joplin without requiring any module', async () => {
    const text = await bundle(createBuildOptions(root));
    let registered = false;
    // eslint-disable-next-line sonarjs/code-eval -- Executes only the bundle built from this repository, with a controlled host stub.
    runInNewContext(text, {
        joplin: {
            plugins: {
                register: (plugin) => {
                    registered = typeof plugin.onStart === 'function';
                },
            },
        },
        console,
        setTimeout,
        clearTimeout,
        require: (name) => {
            throw new Error(`Unexpected runtime dependency: ${name}`);
        },
    });
    assert.equal(registered, true);
});
