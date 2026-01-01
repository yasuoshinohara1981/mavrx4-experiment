/**
 * LFO (Low Frequency Oscillator) Class
 * 低周波オシレーター
 */

export class LFO {
    constructor(rate, minValue, maxValue) {
        this.rate = rate;  // 周波数（1秒あたりの周期数）
        this.minValue = minValue;
        this.maxValue = maxValue;
        this.value = (minValue + maxValue) / 2;  // 初期値は中央
        this.phase = 0.0;  // 位相（0.0〜2π）
    }
    
    /**
     * 更新処理
     * @param {number} deltaTime - 前フレームからの経過時間（秒、オプション）
     */
    update(deltaTime = 1/60) {
        // deltaTimeが無効な値の場合はデフォルト値を使用
        if (!deltaTime || deltaTime <= 0 || !isFinite(deltaTime)) {
            deltaTime = 1/60;
        }
        
        // 周波数rateは「1秒あたりの周期数」なので、実時間deltaTimeに比例して位相を進める。
        // これによりFPSが上下しても“現実時間の揺れ速度”が一定になる。
        this.phase += Math.PI * 2 * this.rate * deltaTime;
        
        // 位相を0〜2πの範囲に制限
        while (this.phase >= Math.PI * 2) {
            this.phase -= Math.PI * 2;
        }
        while (this.phase < 0) {
            this.phase += Math.PI * 2;
        }
        
        // サイン波で値を計算
        const sineValue = Math.sin(this.phase);
        // -1.0〜1.0をminValue〜maxValueにマッピング（Processingのmapと同じ）
        const range = this.maxValue - this.minValue;
        this.value = this.minValue + (sineValue + 1.0) / 2.0 * range;
    }
    
    /**
     * 値を取得
     */
    getValue() {
        return this.value;
    }
    
    /**
     * 範囲を設定
     */
    setRange(minValue, maxValue) {
        this.minValue = minValue;
        this.maxValue = maxValue;
    }
    
    /**
     * rateを設定（ProcessingのsetRateと同じ）
     */
    setRate(rate) {
        this.rate = rate;
    }
    
    /**
     * minValueを設定（ProcessingのsetMinValueと同じ）
     */
    setMinValue(minValue) {
        this.minValue = minValue;
    }
    
    /**
     * maxValueを設定（ProcessingのsetMaxValueと同じ）
     */
    setMaxValue(maxValue) {
        this.maxValue = maxValue;
    }
    
    /**
     * rateを取得（ProcessingのgetRateと同じ）
     */
    getRate() {
        return this.rate;
    }
    
    /**
     * minValueを取得（ProcessingのgetMinValueと同じ）
     */
    getMinValue() {
        return this.minValue;
    }
    
    /**
     * maxValueを取得（ProcessingのgetMaxValueと同じ）
     */
    getMaxValue() {
        return this.maxValue;
    }
    
    /**
     * リセット
     */
    reset() {
        this.phase = 0.0;
        this.value = (this.minValue + this.maxValue) / 2;
    }
}

