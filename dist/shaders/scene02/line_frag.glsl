// Three.js用のフラグメントシェーダー（Scene02用、線描画）
// Processingのline_frag.glslをThree.js用に変換

varying vec4 vertColor;
varying vec2 vertTexCoord;
varying float vertLife;
varying vec3 vertPosition;
varying float vertDistance;  // カメラからの距離（被写界深度用）

uniform float focusDistance;  // 焦点距離
uniform float depthRange;     // 被写界深度の範囲（焦点距離からの許容範囲）
uniform float depthBlurStrength;  // ボケの強度（0.0 = ボケなし、1.0 = 最大ボケ）
uniform vec3 lightPosition;  // ライトの位置（CPU側から渡される）
uniform vec3 lightColor;     // ライトの色（CPU側から渡される）
uniform float materialRoughness;  // マテリアルの粗さ（0.0 = 光沢、1.0 = マット）

void main() {
    // 線の幅方向（テクスチャ座標のY方向）でフェードアウト
    float distFromCenter = abs(vertTexCoord.y - 0.5) * 2.0;  // 0.0-1.0
    
    // 線の端を滑らかに
    float alpha = 1.0 - smoothstep(0.0, 1.0, distFromCenter);
    alpha *= vertLife;
    
    // ライティング計算（線はシンプルに）
    // ライト方向（ライト位置から線の位置への方向）
    vec3 lightDir = normalize(lightPosition - vertPosition);
    
    // 線の方向を推定（テクスチャ座標のX方向が線の方向）
    vec3 lineDir = vec3(1.0, 0.0, 0.0);  // テクスチャ座標のX方向
    
    // 線に垂直な法線を計算（カメラ方向に垂直）
    vec3 viewDir = normalize(-vertPosition);  // カメラ方向（簡易版）
    vec3 normal = normalize(cross(lineDir, viewDir));
    
    // 法線がゼロベクトルの場合、上方向を使用
    if (length(normal) < 0.001) {
        normal = vec3(0.0, 1.0, 0.0);
    }
    
    // ライティング強度（ランバート反射）
    float NdotL = max(dot(normal, lightDir), 0.0);
    
    // アンビエント（環境光） - 線はより明るく
    float ambient = 1.0;
    
    // 拡散反射
    float diffuseStrength = 1.5;
    
    // 最終的なライティング強度
    float lighting = ambient + NdotL * diffuseStrength;
    lighting = min(lighting, 2.5);
    
    // 色にライティングを適用（元の色を保持）
    vec3 litColor = vertColor.rgb * lighting;
    
    // グロー効果を追加（より強く）
    float glow = 1.0 - distFromCenter;
    glow = pow(glow, 2.0);
    litColor += glow * 0.4;
    
    // 被写界深度エフェクト（焦点距離から離れるほどぼかす）
    float depthBlur = 1.0;
    if (depthRange > 0.0) {
        float distanceFromFocus = abs(vertDistance - focusDistance);
        float blurAmount = distanceFromFocus / depthRange;
        blurAmount = clamp(blurAmount, 0.0, 1.0);
        
        // ぼかしの強度（depthBlurStrengthで制御）
        depthBlur = 1.0 - blurAmount * depthBlurStrength;
        
        // 距離が遠いほど透明度のみを下げる（色の強度は維持）
        alpha *= depthBlur;
    }
    
    // 最終的な色を設定
    gl_FragColor = vec4(litColor, alpha * vertColor.a);
}

