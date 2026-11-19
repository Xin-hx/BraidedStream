// Test the tarball in a separate project, without workspace aliases or source imports.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "braided-stream-consumer-"));
function run(command, args, cwd = root) {
  if (command === "npm") {
    assert(process.env.npm_execpath, "Run this check using npm run test:package");
    args = [process.env.npm_execpath, ...args];
    command = process.execPath;
  }
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
try {
  run("npm", ["pack", "--workspace", "braided-stream", "--pack-destination", dir]);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run("npm", ["install", "--ignore-scripts", join(dir, "braided-stream-0.1.0.tgz"), "d3@^7.9.0", "jsdom@^30.1.0"], dir);
  writeFileSync(join(dir, "consumer.mjs"), `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { select } from 'd3';
    import { JSDOM } from 'jsdom';
    import { runPipeline, preparePipeline } from 'braided-stream/core';
    import { braidedStream, streamTimeFilter } from 'braided-stream';
    assert.equal(typeof document, 'undefined');
    const dataset = { times: ['t1', 't2'], layers: [{ id: 'a', measures: [1, 3].map(value => ({ components: [{ kind: 'atom', value, mass: 1 }] })) }] };
    const result = runPipeline(dataset);
    const pipeline = preparePipeline(dataset);
    assert.deepEqual(pipeline.run(), result);
    assert.deepEqual(pipeline.run({ baselineMode: 'sine' }), runPipeline(dataset, { baselineMode: 'sine' }));
    assert.equal('densityProfiles' in result, false);
    const dom = new JSDOM('<svg id="chart"></svg><svg id="filter"></svg>');
    const svg = dom.window.document.getElementById('chart');
    const filterSvg = dom.window.document.getElementById('filter');
    const chart = braidedStream().options({ width: 800, height: 400 });
    for (const visMethod of ['braided', 'streamgraph']) {
      select(svg).datum({ dataset, result }).call(chart.options({ visMethod }));
      assert(svg.querySelector('path'));
      assert(!/NaN|undefined/.test(svg.outerHTML));
    }
    const overview = streamTimeFilter();
    select(filterSvg).datum({ dataset, result }).call(overview);
    assert(filterSvg.querySelector('.overlay'));
    assert(readFileSync(new URL(import.meta.resolve('braided-stream/style.css')), 'utf8').includes('.braided-stream'));
    chart.destroy(select(svg)); overview.destroy(select(filterSvg));
    assert.equal(svg.children.length, 0);
    assert.equal(filterSvg.children.length, 0);
    console.log('Packed ESM/core/rendering/styles/lifecycle passed.');
  `);
  writeFileSync(join(dir, "consumer.ts"), `
    import { select } from 'd3';
    import { braidedStream, streamTimeFilter, type InputDataset, type HoverEvent } from 'braided-stream';
    import { runPipeline, preparePipeline } from 'braided-stream/core';
    declare const svg: SVGSVGElement;
    declare const dataset: InputDataset;
    const chart = braidedStream().options({ width: 800 }).pipelineOptions({ baselineMode: 'wiggle' });
    chart.on('hover.test', event => { const typed: HoverEvent = event; console.log(typed.timeIndex); });
    // @ts-expect-error Fluent options must retain their types.
    chart.options({ visMethod: 'invalid' });
    // @ts-expect-error Removed methods must not remain in the public API.
    chart.options({ visMethod: 'star' });
    // @ts-expect-error Streamgraph replaces the former collapse option.
    chart.options({ collapseBranches: true });
    // @ts-expect-error Density rendering was removed; layer color overrides remain supported.
    chart.options({ showDensityGradient: true });
    chart.options({ colorOverrides: { a: '#123456' } });
    const pipeline = preparePipeline(dataset);
    select(svg).datum({ dataset, result: pipeline.run({ baselineMode: 'sine' }) }).call(chart);
    // @ts-expect-error Hover events must retain their types.
    chart.on('hover.test', event => console.log(event.nonexistent));
    select(svg).datum(dataset).call(chart);
    select(svg).datum({ dataset, result: runPipeline(dataset) }).call(streamTimeFilter());
  `);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    noEmit: true, skipLibCheck: false,
  }, include: ["consumer.ts"] }));
  console.log(run(process.execPath, [join(dir, "consumer.mjs")], dir).trim());
  run(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", join(dir, "tsconfig.json")], dir);
  console.log("Packed consumer TypeScript (NodeNext, strict) passed.");
} finally {
  assert.equal(dirname(dir), resolve(tmpdir()));
  assert(basename(dir).startsWith("braided-stream-consumer-"));
  rmSync(dir, { recursive: true, force: true });
}
