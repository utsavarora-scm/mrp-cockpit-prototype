/**
 * Low-level code assignment.
 *
 * The low-level code of an item-plant is the length of the longest path from any
 * independent-demand item down to it. Netting must be processed in ascending
 * low-level code order, otherwise a component gets netted before all of its
 * parents have contributed dependent demand and the plan is quietly wrong.
 *
 * Nodes are item-plant pairs rather than items, so that transfers between plants
 * order correctly alongside BOM levels: a transfer creates demand at the source
 * plant, which therefore must be planned after the receiving plant.
 *
 * A BOM that references itself, directly or through a chain, is a data defect
 * rather than a crash. Cycles are detected, reported as `B-CIRCULAR-BOM`, and
 * the remaining items are still planned.
 */

import { type BomLine, type ItemPlant, planKey } from '@repo/domain';

export interface LowLevelCodeResult {
  /** planKey → low-level code. */
  codes: Map<string, number>;
  /** planKeys in ascending low-level code order — the netting sequence. */
  order: string[];
  /** planKeys that participate in a BOM cycle. */
  circular: string[];
  /** Highest low-level code assigned. */
  maxCode: number;
}

export function assignLowLevelCodes(
  itemPlants: ItemPlant[],
  boms: BomLine[],
  /** Only BOM lines active at some point in the horizon shape the graph. */
  isBomActive: (bom: BomLine) => boolean
): LowLevelCodeResult {
  const nodes = new Set<string>();
  for (const ip of itemPlants) nodes.add(planKey(ip.itemId, ip.plantId));

  /** parent planKey → component planKeys. */
  const children = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) inDegree.set(node, 0);

  const addEdge = (from: string, to: string) => {
    if (!nodes.has(from) || !nodes.has(to) || from === to) return;
    let set = children.get(from);
    if (!set) {
      set = new Set<string>();
      children.set(from, set);
    }
    if (set.has(to)) return;
    set.add(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  };

  for (const bom of boms) {
    if (!isBomActive(bom)) continue;
    addEdge(planKey(bom.parentItemId, bom.plantId), planKey(bom.componentItemId, bom.plantId));
  }
  for (const ip of itemPlants) {
    if (ip.procurementType === 'TRANSFER' && ip.sourcePlantId) {
      addEdge(planKey(ip.itemId, ip.plantId), planKey(ip.itemId, ip.sourcePlantId));
    }
  }

  const codes = new Map<string, number>();
  const queue: string[] = [];
  for (const node of nodes) {
    if ((inDegree.get(node) ?? 0) === 0) {
      codes.set(node, 0);
      queue.push(node);
    }
  }

  const order: string[] = [];
  // Kahn's algorithm, relaxing to the *longest* path rather than any path —
  // an item used at two different depths must be netted at the deeper one.
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head] as string;
    order.push(node);
    const nodeCode = codes.get(node) ?? 0;
    const kids = children.get(node);
    if (!kids) continue;
    for (const child of kids) {
      const existing = codes.get(child) ?? 0;
      if (nodeCode + 1 > existing) codes.set(child, nodeCode + 1);
      const remaining = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, remaining);
      if (remaining === 0) queue.push(child);
    }
  }

  const circular: string[] = [];
  if (order.length < nodes.size) {
    const settled = new Set(order);
    for (const node of nodes) {
      if (!settled.has(node)) circular.push(node);
    }
    let deepest = 0;
    for (const code of codes.values()) if (code > deepest) deepest = code;
    // Cycle members still need planning, at the deepest level so their
    // dependent demand is at least gathered before they are netted.
    for (const node of circular) {
      codes.set(node, deepest + 1);
      order.push(node);
    }
  }

  order.sort((a, b) => {
    const delta = (codes.get(a) ?? 0) - (codes.get(b) ?? 0);
    return delta !== 0 ? delta : a < b ? -1 : a > b ? 1 : 0;
  });

  let maxCode = 0;
  for (const code of codes.values()) if (code > maxCode) maxCode = code;

  return { codes, order, circular, maxCode };
}
