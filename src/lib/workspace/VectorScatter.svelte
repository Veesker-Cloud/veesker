<script lang="ts">
  import type { VectorSearchResult } from "$lib/workspace";

  type Props = {
    result: VectorSearchResult;
  };
  let { result }: Props = $props();

  const W = 600;
  const H = 320;
  const PAD = 36;

  // 2-PC power-iteration PCA on the result vectors
  function pca2d(vecs: number[][]): [number, number][] {
    const n = vecs.length;
    if (n < 2) return vecs.map(() => [0, 0] as [number, number]);
    const d = vecs[0].length;
    if (d === 0) return vecs.map(() => [0, 0] as [number, number]);

    const mean = new Array<number>(d).fill(0);
    for (const v of vecs) for (let i = 0; i < d; i++) mean[i] += v[i] / n;
    const X = vecs.map(v => v.map((x, i) => x - mean[i]));

    function powerIter(data: number[][]): number[] {
      // Seeded deterministic init using first data point direction
      let vec = data[0].slice();
      let norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
      vec = vec.map(x => x / norm);
      for (let iter = 0; iter < 60; iter++) {
        const proj = data.map(row => row.reduce((s, x, i) => s + x * vec[i], 0));
        const nv = new Array<number>(d).fill(0);
        for (let r = 0; r < n; r++) for (let i = 0; i < d; i++) nv[i] += proj[r] * data[r][i];
        norm = Math.sqrt(nv.reduce((s, x) => s + x * x, 0));
        if (norm < 1e-12) break;
        vec = nv.map(x => x / norm);
      }
      return vec;
    }

    const pc1 = powerIter(X);
    const scores1 = X.map(row => row.reduce((s, x, i) => s + x * pc1[i], 0));
    const deflated = X.map((row, r) => row.map((x, i) => x - scores1[r] * pc1[i]));
    const pc2 = powerIter(deflated);
    const scores2 = X.map(row => row.reduce((s, x, i) => s + x * pc2[i], 0));

    return scores1.map((s1, i) => [s1, scores2[i]] as [number, number]);
  }

  const points = $derived.by(() => {
    const { vectors, queryVector, scores, rows, columns } = result;
    if (!vectors || vectors.length === 0) return null;

    const allVecs = queryVector ? [...vectors, queryVector] : vectors;
    const proj = pca2d(allVecs);
    const resultProj = proj.slice(0, vectors.length);
    const queryProj = queryVector ? proj[vectors.length] : null;

    // Normalize to [0,1]
    const xs = proj.map(p => p[0]);
    const ys = proj.map(p => p[1]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const toSvg = ([px, py]: [number, number]) => ({
      x: PAD + ((px - xMin) / xRange) * (W - PAD * 2),
      y: PAD + (1 - (py - yMin) / yRange) * (H - PAD * 2),
    });

    const scoreCol = columns.findIndex(c => c.name === "VD_SCORE");
    const dataCols = columns.filter(c => c.name !== "VD_SCORE");

    return {
      dots: resultProj.map((p, i) => {
        const sim = 1 - scores[i];
        const { x, y } = toSvg(p);
        const dataVals = (rows[i] as unknown[]).filter((_, idx) => idx !== scoreCol);
        const label = String(dataVals.find(v => v != null) ?? i);
        return { x, y, sim, label, row: dataVals, cols: dataCols };
      }),
      query: queryProj ? toSvg(queryProj) : null,
    };
  });

  let hoveredIdx = $state<number | null>(null);

  function simColor(sim: number): string {
    // green (high) → orange → red (low)
    const r = Math.round(sim > 0.5 ? 179 + (1 - sim) * 2 * 76 : 255);
    const g = Math.round(sim > 0.5 ? 175 : sim * 2 * 175);
    return `rgb(${r},${g},50)`;
  }
</script>

{#if !points}
  <div class="scatter-loading">No vector data — enable "Include vectors" before searching</div>
{:else}
  <div class="scatter-wrap">
    <svg width="100%" height={H} viewBox="0 0 {W} {H}" class="scatter-svg" preserveAspectRatio="xMidYMid meet">
      <!-- Grid -->
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="rgba(26,22,18,0.08)" stroke-width="1"/>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(26,22,18,0.08)" stroke-width="1"/>
      <text x={W / 2} y={H - 6} font-size="9" fill="rgba(26,22,18,0.3)" text-anchor="middle" font-family="JetBrains Mono, monospace">PC1</text>
      <text x={8} y={H / 2} font-size="9" fill="rgba(26,22,18,0.3)" text-anchor="middle" font-family="JetBrains Mono, monospace" transform="rotate(-90,8,{H/2})">PC2</text>

      <!-- Query point -->
      {#if points.query}
        <circle cx={points.query.x} cy={points.query.y} r="9" fill="rgba(124,58,237,0.12)" stroke="#7c3aed" stroke-width="1.5"/>
        <text x={points.query.x} y={points.query.y + 4} text-anchor="middle" font-size="9" fill="#7c3aed" font-weight="bold">Q</text>
      {/if}

      <!-- Result dots -->
      {#each points.dots as dot, i}
        <circle
          cx={dot.x} cy={dot.y} r={hoveredIdx === i ? 7 : 5}
          fill={simColor(dot.sim)}
          fill-opacity="0.85"
          stroke={hoveredIdx === i ? "rgba(26,22,18,0.6)" : "rgba(26,22,18,0.15)"}
          stroke-width={hoveredIdx === i ? 1.5 : 1}
          style="cursor:pointer;transition:r 0.1s"
          onmouseenter={() => hoveredIdx = i}
          onmouseleave={() => hoveredIdx = null}
          role="img"
          aria-label="Result {i+1} similarity {dot.sim.toFixed(3)}"
        />
        {#if hoveredIdx === i}
          {@const tipW = 162}
          {@const tipH = 82}
          {@const rawTx = dot.x + (dot.x > W * 0.7 ? -(tipW + 6) : 10)}
          {@const rawTy = dot.y + (dot.y > H * 0.7 ? -(tipH + 4) : 4)}
          {@const tx = Math.max(PAD, Math.min(rawTx, W - tipW - 2))}
          {@const ty = Math.max(PAD, Math.min(rawTy, H - tipH - 2))}
          <foreignObject x={tx} y={ty} width={tipW} height={tipH}>
            <div class="dot-tip">
              <div class="tip-score">sim {dot.sim.toFixed(3)}</div>
              {#each dot.cols.slice(0, 3) as col, ci}
                <div class="tip-row"><span class="tip-col">{col.name}</span> {String(dot.row[ci] ?? "").slice(0, 40)}</div>
              {/each}
            </div>
          </foreignObject>
        {/if}
      {/each}
    </svg>

    <div class="scatter-legend">
      <span class="legend-dot" style="background: rgb(179,175,50)"></span> high
      <span class="legend-dot" style="background: rgb(255,87,50); margin-left:0.5rem"></span> low
      {#if points.query}<span style="margin-left:0.75rem; color:#7c3aed; opacity:0.8">⬤ Q = sua busca</span>{/if}
    </div>
  </div>
{/if}

<style>
  .scatter-wrap {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.3rem;
    padding: 0.5rem 0.75rem;
    background: #faf7f2;
    position: relative;
    z-index: 1;
    min-height: 340px;
  }
  .scatter-svg { display: block; width: 100%; }
  .scatter-loading {
    color: rgba(26,22,18,0.35);
    font-size: 11px;
    padding: 2rem 1rem;
    text-align: center;
  }
  .scatter-legend {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 10px;
    color: rgba(26,22,18,0.4);
    font-family: "JetBrains Mono", monospace;
  }
  .legend-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot-tip {
    background: rgba(255,252,245,0.97);
    border: 1px solid rgba(26,22,18,0.12);
    border-radius: 5px;
    padding: 5px 7px;
    font-size: 10px;
    color: rgba(26,22,18,0.8);
    font-family: "Inter", sans-serif;
    pointer-events: none;
    max-width: 160px;
    box-shadow: 0 2px 8px rgba(26,22,18,0.1);
  }
  .tip-score {
    color: #7c3aed;
    font-weight: 600;
    margin-bottom: 2px;
    font-family: "JetBrains Mono", monospace;
  }
  .tip-row {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9.5px;
    color: rgba(26,22,18,0.65);
  }
  .tip-col {
    color: rgba(26,22,18,0.35);
    margin-right: 3px;
  }
</style>
