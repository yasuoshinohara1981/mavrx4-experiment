varying vec3 vColor;

void main() {
    // 線を太くするために、距離ベースのアルファを使用
    // ただし、LineSegmentsではgl_FragCoordから線の中心までの距離を計算できないため、
    // 単純に透明度を調整して線を太く見せる
    
    // 透明度220（Processingと同じ）
    float alpha = 220.0 / 255.0;
    
    // 線を太く見せるために、より不透明にする（オプション）
    // alpha = min(1.0, alpha * 1.2);  // 20%明るく
    
    gl_FragColor = vec4(vColor, alpha);
}
