/**
 * TimelineSceneBase（WebGPU）
 *
 * 共通化したい仕組み：
 * - タイムライン（actual_tick）に沿ってカメラが一定速度で進む（ピアノロール）
 * - オブジェクトは tick→Z の軸上に生成していく（空白もそのまま空白）
 *
 * 使い方（Scene側）:
 * - constructorで this.look / this.cameraCenter を用意（Scene03方式）
 * - setupで `this.setupTimeline({ laneCount, zPerTick, zOffset, minGapTicks, lookAheadTicks, fallbackSpeed })`
 * - 毎フレ `this.updateTimelineRail(dt)` を呼ぶ（cameraCenter.zが更新される）
 * - イベント生成時に `this.computeEventZ({ laneIndex, tickNow, lastTickByLane })` を使う
 */

import { SceneTemplate } from './SceneTemplate.js';

export class TimelineSceneBase extends SceneTemplate {
    constructor(renderer, camera, sharedResourceManager = null) {
        super(renderer, camera, sharedResourceManager);

        this.timeline = {
            z: -2.0,
            // tick → Z
            zPerTick: 0.065,
            zOffset: -2.0,
            // 同レーンで詰まりすぎた時の最小ギャップ
            minGapTicks: 6,
            // tickが無い時のフォールバック移動
            fallbackSpeed: 0.70, // unit/sec
            // lane別の最後のtick
            lastTickByLane: [],
        };

        // lookAheadをtick単位で扱う
        this.lookAheadTicks = 96 * 2;
    }

    setupTimeline({ laneCount = 0, zPerTick, zOffset, minGapTicks, lookAheadTicks, fallbackSpeed } = {}) {
        if (Number.isFinite(zPerTick)) this.timeline.zPerTick = Number(zPerTick);
        if (Number.isFinite(zOffset)) this.timeline.zOffset = Number(zOffset);
        if (Number.isFinite(minGapTicks)) this.timeline.minGapTicks = Math.max(0, Math.floor(Number(minGapTicks)));
        if (Number.isFinite(fallbackSpeed)) this.timeline.fallbackSpeed = Number(fallbackSpeed);
        if (Number.isFinite(lookAheadTicks)) this.lookAheadTicks = Math.max(0, Math.floor(Number(lookAheadTicks)));

        const n = Math.max(0, Math.floor(Number(laneCount) || 0));
        this.timeline.lastTickByLane = new Array(n).fill(null);
    }

    getTickNow() {
        const t = Number(this.actualTick);
        return Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0;
    }

    tickToZ(tick) {
        const t = Math.max(0, Math.floor(Number(tick) || 0));
        return this.timeline.zOffset - t * this.timeline.zPerTick;
    }

    /**
     * cameraCenter.z を actual_tick に沿って更新（無ければ一定速度）
     * - Scene側で this.cameraCenter(Vector3) を持っている前提
     */
    updateTimelineRail(dt) {
        if (!this.timeline || !this.cameraCenter) return;
        const tick = Number(this.actualTick);
        if (Number.isFinite(tick) && tick > 0) {
            this.timeline.z = this.tickToZ(tick);
        } else {
            this.timeline.z += -1 * this.timeline.fallbackSpeed * dt;
        }
        // YはScene側の責務（ここではZだけ）
        this.cameraCenter.z = this.timeline.z;
    }

    /**
     * イベントのZ（tick基準）を決める
     * - 同レーンで間隔が詰まったら、少し奥へ逃がす（重なり防止）
     */
    computeEventZ({ laneIndex = 0, tickNow = null, lastTickByLane = null } = {}) {
        const tNow = (tickNow == null) ? this.getTickNow() : Math.max(0, Math.floor(Number(tickNow) || 0));
        const zBase = this.tickToZ(tNow);
        const gap = Number(this.timeline?.minGapTicks ?? 6);
        const lastArr = lastTickByLane || this.timeline?.lastTickByLane;
        const prev = (Array.isArray(lastArr)) ? lastArr[laneIndex] : null;

        let zJitter = 0.0;
        if (prev != null && (tNow - prev) < gap) {
            const need = gap - (tNow - prev);
            zJitter = -need * Number(this.timeline?.zPerTick ?? 0.065) * 0.85;
        }
        if (Array.isArray(lastArr)) lastArr[laneIndex] = tNow;
        return { z: zBase + zJitter, tick: tNow };
    }

    /**
     * chase/pullback によって「見る向き」を変えたい時用
     */
    getViewDirSign() {
        return (this.cameraView?.mode === 'pullback') ? 1 : -1;
    }
}


