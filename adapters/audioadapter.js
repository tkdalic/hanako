const path = require('path');
const logger = require('log4js').getLogger(path.basename(__filename));
const assert = require('assert').strict;
const { Readable } = require('stream');
const CombinedStream = require('combined-stream2');
const { AudioRequest, RequestType } = require('../models/audiorequest');
const { AudioStreamAdapter } = require('./interfaces');
const { EbyroidAdapter } = require('./ebyroid');
const { SoundAdapter } = require('./sound');
const { NoopAdapter } = require('./noop');
const { FileAdapterErrors } = require('./fileadapter');

/**
 * combined-stream2用
 *
 * @param {CombinedStream} cs2
 * @param {Readable} stream
 * @returns {CombinedStream}
 */
function cs2reducer(cs2, stream) {
    cs2.append(stream);
    return cs2;
}

// FIXME 並列複数Hz問題が解決したらいらなくなる処理
const sconv_size = 4 * 0xff;
function sconv(streams) {
    const arr = [];
    const len = streams.length * 2 - 1;
    for (let i = 0; i < len; i++) {
        if (!(i & 1)) {
            arr[i] = streams.shift();
        } else {
            arr[i] = Readable.from(Buffer.alloc(sconv_size), { objectMode: false });
        }
    }
    return arr;
}

// FIXME discord.jsがStream3 APIに移行してcombined-stream2が不要になったらいらなくなる処理
//       配列の最後がFileStreamのときcombined-stream2君が処理できない
const atail_size = 4 * 0x10;
function atail(streams) {
    streams.push(Readable.from(Buffer.alloc(atail_size), { objectMode: false }));
    return streams;
}

// See: https://github.com/nodejs/help/issues/2487
function clean(results) {
    function _clean(stream) {
        return new Promise(resolve => {
            // 活性な（生まれたてでI/O多発）のパイプに.destroy()を使う時
            // closeがパイプ上流に行き渡ってからじゃないと登録済みの書き込みイベントが次のティックで着火して死ぬ
            // なんじゃそらふざけてんのか
            stream.emit('close');
            setImmediate(() => {
                stream.destroy();
                logger.info('ストリームリークを回避');
                resolve();
            });
        });
    }
    const err = results.find(r => r.reason).reason;
    const ps = results.filter(r => r.value).map(r => _clean(r.value));
    return Promise.all(ps).then(() => Promise.reject(err));
}

/**
 * 音声・サウンドリクエスト用アダプタ
 */
class AudioAdapter {
    /**
     * @param {object} adapters
     * @param {AudioStreamAdapter?} adapters.ebyroid
     * @param {AudioStreamAdapter?} adapters.sound
     */
    constructor(adapters) {
        /**
         * @type {Map<string, AudioStreamAdapter>}
         * @private
         */
        this.adapters = new Map();
        this.adapters.set(RequestType.EBYROID, adapters.ebyroid || null);
        this.adapters.set(RequestType.SOUND, adapters.sound || null);

        const instances = Array.from(this.adapters.values());
        if (instances.every(x => x === null)) {
            throw new Error('読み上げには最低でもひとつのオーディオソースが必要です。');
        }

        // NO-OPは常に必要
        this.adapters.set(RequestType.NO_OP, new NoopAdapter());
    }

    /**
     * @param {AudioRequest[]} requests
     * @returns {Promise<Readable>}
     * @throws {FileAdapterErrors.NOT_FOUND}
     */
    acceptAudioRequests(requests) {
        assert(requests.length > 0);
        if (requests.every(r => r.type === RequestType.NO_OP)) {
            // 純粋なNO-OP配列だったときの特別処理（連結しない）
            return this.adapters.get(RequestType.NO_OP).requestAudioStream(requests[0]);
        }
        const promises = requests.map(r => this.adapters.get(r.type).requestAudioStream(r));
        const all = Promise.allSettled(promises).then(rs =>
            rs.every(r => r.value) ? rs.map(r => r.value) : clean(rs)
        );
        return all.then(streams => atail(sconv(streams)).reduce(cs2reducer, CombinedStream.create()));
    }
}

/**
 * 音声・サウンドリクエストマネージャ
 */
class AudioAdapterManager {
    /**
     * 初期化処理
     *
     * @param {object} options
     * @param {?object} options.ebyroid
     * @param {string}  options.ebyroid.baseUrl
     */
    static init(options) {
        const adapters = {};

        if (options.ebyroid) {
            adapters.ebyroid = new EbyroidAdapter(options.ebyroid.baseUrl);
            this.uses.ebyroid = true;
        }

        adapters.sound = new SoundAdapter();
        this.uses.sound = true;

        this.adapter = new AudioAdapter(adapters);
    }

    /**
     * リクエストを連結して単一の音声ストリームを取得
     *
     * @param  {...AudioRequest} reqs
     * @returns {Promise<Readable>}
     * @throws {FileAdapterErrors.NOT_FOUND}
     */
    static request(...reqs) {
        if (!this.uses.ebyroid) {
            const newReqs = reqs.filter(req => req.type !== RequestType.EBYROID);
            if (newReqs.length !== reqs.length) {
                logger.warn('Ebyroidへのリクエストが要求されましたが、Ebyroid利用設定がありません。');
                reqs = newReqs;
            }
        }
        if (reqs.length === 0) {
            return Promise.reject('空のリクエスト');
        }
        return this.adapter.acceptAudioRequests(reqs);
    }
}

/**
 * @type {AudioAdapter}
 */
AudioAdapterManager.adapter = null;

/**
 * @namespace
 * @property {boolean} ebyroid
 * @property {boolean} sound
 */
AudioAdapterManager.uses = { ebyroid: false, sound: false };

module.exports = {
    AudioAdapterManager,
};
