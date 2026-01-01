/**
 * OSC通信管理クラス
 * WebSocket経由でOSCメッセージを受信
 */

export class OSCManager {
    constructor(options = {}) {
        this.wsUrl = options.wsUrl || 'ws://localhost:8080';
        this.onMessage = options.onMessage || null;
        this.onStatusChange = options.onStatusChange || null;
        
        this.ws = null;
        this.isConnected = false;

        // 再接続制御
        this._reconnectTimer = null;
        this._reconnectAttempt = 0;
        this._connecting = false;
        
        this.init();
    }
    
    init() {
        if (this._connecting) return;
        this._connecting = true;

        // 既存の接続/タイマーを片付け
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this.ws) {
            try {
                this.ws.onopen = null;
                this.ws.onmessage = null;
                this.ws.onclose = null;
                this.ws.onerror = null;
                if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                    this.ws.close();
                }
            } catch (_) {}
            this.ws = null;
        }

        try {
            // WebSocket接続
            this.ws = new WebSocket(this.wsUrl);
            
            // 接続成功
            this.ws.onopen = () => {
                this.isConnected = true;
                this._connecting = false;
                this._reconnectAttempt = 0;
                if (this.onStatusChange) {
                    this.onStatusChange('Connected');
                }
                console.log(`OSC: WebSocket接続成功 (${this.wsUrl})`);
            };
            
            // メッセージ受信
            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleMessage(message);
                } catch (error) {
                    console.error('OSCメッセージパースエラー:', error);
                }
            };
            
            // 接続終了
            this.ws.onclose = () => {
                this.isConnected = false;
                this._connecting = false;
                if (this.onStatusChange) {
                    this.onStatusChange('Disconnected');
                }
                console.log('OSC: WebSocket接続終了');
                
                // 再接続を試みる（バックオフ）
                const delay = Math.min(10000, 500 + this._reconnectAttempt * 750);
                this._reconnectAttempt++;
                this._reconnectTimer = setTimeout(() => {
                    console.log('OSC: 再接続を試みます...');
                    this.init();
                }, delay);
            };
            
            // エラーハンドリング
            this.ws.onerror = (error) => {
                console.error('OSC WebSocket Error:', error);
                if (this.onStatusChange) {
                    this.onStatusChange('Error');
                }
                console.log('OSC: WebSocketサーバーに接続できません。');
                console.log('OSC: 別ターミナルで "npm run osc-server" を実行してください。');

                // 環境によっては onerror の後に onclose が来ないことがあるので、ここでも再接続へ寄せる
                try {
                    this.ws?.close();
                } catch (_) {}
                this.isConnected = false;
                this._connecting = false;
                if (!this._reconnectTimer) {
                    const delay = Math.min(10000, 500 + this._reconnectAttempt * 750);
                    this._reconnectAttempt++;
                    this._reconnectTimer = setTimeout(() => {
                        console.log('OSC: 再接続を試みます...');
                        this.init();
                    }, delay);
                }
            };
            
        } catch (error) {
            console.error('OSC初期化エラー:', error);
            if (this.onStatusChange) {
                this.onStatusChange('Error');
            }
            this._connecting = false;
        }
    }
    
    handleMessage(message) {
        // メッセージは既にパース済み（JSON形式）
        // コールバックを呼び出し
        if (this.onMessage) {
            this.onMessage(message);
        }
    }
    
    close() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
        }
    }
}

