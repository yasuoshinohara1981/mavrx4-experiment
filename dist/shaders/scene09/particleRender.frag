varying vec3 vColor;
varying vec3 vPosition;
varying vec3 vNormal;

uniform float metaballRadius;  // メタボールの影響半径
uniform float metaballStrength;  // メタボールの強度

void main() {
    // 円形のパーティクルを描画
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distFromCenter = length(coord);
    
    // メタボールの距離フィールドを計算（1/r^2形式）
    // パーティクルの中心からの距離を正規化
    float normalizedDist = distFromCenter * 2.0;  // 0.0～1.0
    float r = normalizedDist * metaballRadius;
    
    // メタボールの強度関数：1 / (1 + (r/R)^2)
    float field = metaballStrength / (1.0 + r * r);
    
    // 閾値でクリッピング（滑らかなエッジ）
    float alpha = smoothstep(0.0, 0.1, field);
    
    // ビルボードの円を球体に見せるために法線を計算
    float z = sqrt(max(0.0, 1.0 - distFromCenter * distFromCenter * 4.0));
    vec3 sphereNormal = normalize(vec3(coord * 2.0, z));
    
    // ビルボード平面上での球体の法線を、ワールド空間の法線に変換
    vec3 viewDir = normalize(vNormal);
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(up, viewDir));
    vec3 upCorrected = cross(viewDir, right);
    vec3 normal = normalize(viewDir * sphereNormal.z + right * sphereNormal.x + upCorrected * sphereNormal.y);
    
    // 白いメタボール
    vec3 metaballColor = vColor;
    
    // 法線ベースのライティング
    vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
    float NdotL = max(dot(normal, lightDir), 0.0);
    vec3 ambient = vec3(0.4, 0.4, 0.4);
    vec3 diffuse = vec3(1.0, 1.0, 1.0) * NdotL;
    metaballColor = metaballColor * (ambient + diffuse);
    
    gl_FragColor = vec4(metaballColor, alpha);
}
