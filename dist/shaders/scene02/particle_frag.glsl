// Three.js用のフラグメントシェーダー（Scene02用）
// Processingのparticle_frag.glslをThree.js用に変換

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
uniform bool useSSAO;        // SSAOを使用するか
uniform float ssaoRadius;   // SSAOのサンプル半径
uniform float ssaoStrength;  // SSAOの強度
uniform int ssaoSamples;     // SSAOのサンプル数
uniform vec3 cameraPosition;  // カメラの位置（SSAO用）
uniform vec3 sphereColor;    // スフィアの色（uniformとして設定）

void main() {
    // 色を決定（uniformが設定されている場合はそれを使用、そうでなければvertColorを使用）
    vec3 baseColor = vertColor.rgb;
    // テクスチャ座標を中心に（0.0-1.0 → -0.5-0.5）
    vec2 center = vertTexCoord - vec2(0.5);
    float dist = length(center);
    
    // 円形のパーティクルを描画（中心から外側に向かってフェードアウト）
    float radius = 0.5;
    if (dist > radius) {
        discard;  // 円の外側は描画しない
    }
    
    // 距離に応じた透明度を計算（よりシャープなエッジ、ボヤーを減らす）
    float edgeWidth = 0.05;  // エッジの幅を狭く
    float alpha = 1.0 - smoothstep(radius - edgeWidth, radius, dist);
    
    // 寿命に応じた透明度を適用
    alpha *= vertLife;
    
    // ライティング計算
    // 法線ベクトル（ポイントスプライトの中心から外側への方向）
    vec3 normal = vec3(center * 2.0, sqrt(1.0 - dot(center, center) * 4.0));
    normal = normalize(normal);
    
    // ライト方向（ライト位置からパーティクル位置への方向）
    vec3 lightDir = normalize(lightPosition - vertPosition);
    
    // ライティング強度（ランバート反射）
    float NdotL = max(dot(normal, lightDir), 0.0);
    
    // スペキュラ反射（ハイライト）
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightDir, normal);
    
    // アンビエント（環境光） - より明るく
    float ambient = 0.9;
    
    // マテリアルの粗さに応じてライティングを調整
    float diffuseStrength = mix(1.5, 2.0, materialRoughness);
    float specularStrength = mix(0.8, 0.1, materialRoughness);
    float specularPower = mix(32.0, 8.0, materialRoughness);
    float specular = pow(max(dot(viewDir, reflectDir), 0.0), specularPower);
    
    // 最終的なライティング強度 - 全体的に明るく
    float lighting = ambient + NdotL * diffuseStrength + specular * specularStrength;
    lighting = min(lighting, 3.0);
    
    // 色にライティングを適用（元の色を保持、ライトの色は控えめに）
    vec3 litColor = baseColor * lighting;
    
    // グロー効果を追加（元の色を保持、より強く）
    float glow = 1.0 - (dist / radius);
    glow = pow(glow, 1.5);
    litColor += baseColor * glow * 0.5;
    
    // 簡易SSAO（軽量版：法線方向に沿って周囲のオブジェクトの影響をシミュレート）
    float occlusion = 1.0;
    if (useSSAO && ssaoStrength > 0.0) {
        vec3 viewDir = normalize(cameraPosition - vertPosition);
        vec3 tangent = normalize(cross(normal, viewDir));
        if (length(tangent) < 0.001) {
            tangent = normalize(cross(normal, vec3(0.0, 1.0, 0.0)));
        }
        vec3 bitangent = normalize(cross(normal, tangent));
        
        float occlusionSum = 0.0;
        int sampleCount = 0;
        
        // 簡易的なサンプリング（法線方向に沿って）
        for (int i = 0; i < 8; i++) {
            if (i >= ssaoSamples) break;
            
            float angle = float(i) * 3.14159 * 2.0 / float(ssaoSamples);
            float sampleDist = ssaoRadius * (0.5 + 0.5 * sin(float(i) * 0.7));
            
            vec3 sampleDir = normal + (tangent * cos(angle) + bitangent * sin(angle)) * 0.3;
            sampleDir = normalize(sampleDir);
            
            float sampleDistFactor = sampleDist / ssaoRadius;
            occlusionSum += sampleDistFactor * 0.1;
            sampleCount++;
        }
        
        if (sampleCount > 0) {
            occlusion = 1.0 - (occlusionSum / float(sampleCount)) * ssaoStrength;
            occlusion = clamp(occlusion, 0.0, 1.0);
        }
    }
    
    // SSAOを適用
    litColor *= occlusion;
    
    // 被写界深度エフェクト（焦点距離から離れるほどぼかす）
    float depthBlur = 1.0;
    if (depthRange > 0.0) {
        float distanceFromFocus = abs(vertDistance - focusDistance);
        float blurAmount = distanceFromFocus / depthRange;
        blurAmount = clamp(blurAmount, 0.0, 1.0);
        
        // ぼかしの強度（depthBlurStrengthで制御、デフォルトは0.1 = かなり薄く）
        depthBlur = 1.0 - blurAmount * depthBlurStrength;
        
        // 距離が遠いほど透明度のみを下げる（色の強度は維持）
        alpha *= depthBlur;
    }
    
    // 最終的な色を設定
    gl_FragColor = vec4(litColor, alpha * vertColor.a);
}

