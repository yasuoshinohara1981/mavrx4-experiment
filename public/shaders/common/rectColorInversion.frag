uniform sampler2D tDiffuse;
uniform vec2 resolution;  // 画面解像度
uniform float rectY;     // 矩形のY位置（正規化座標、下が0.0、上が1.0）
uniform float rectHeight; // 矩形の高さ（正規化座標、0.0〜1.0）
uniform float enabled;   // エフェクトが有効かどうか（0.0または1.0）

varying vec2 vUv;

void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    
    // 矩形部分かどうかを判定（vUv.yは上が0.0、下が1.0）
    // rectYは下からの位置なので、1.0 - rectYで上からの位置に変換
    float normalizedY = vUv.y;  // vUv.yは上が0.0、下が1.0
    float rectTop = 1.0 - (rectY + rectHeight);  // 矩形の上端（正規化座標）
    float rectBottom = 1.0 - rectY;  // 矩形の下端（正規化座標）
    bool inRect = normalizedY >= rectTop && normalizedY <= rectBottom;
    
    if (enabled > 0.5 && inRect) {
        // 矩形部分だけ色を反転
        vec3 invertedColor = vec3(1.0) - color.rgb;
        // 黒い背景を半透明で重ねる（反転した色を暗くする）
        vec3 finalColor = mix(invertedColor, vec3(0.0), 0.5);
        gl_FragColor = vec4(finalColor, color.a);
    } else {
        // 矩形外はそのまま
        gl_FragColor = color;
    }
}

