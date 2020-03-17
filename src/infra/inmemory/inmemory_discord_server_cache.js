const path = require('path');
const logger = require('log4js').getLogger(path.basename(__filename));
const assert = require('assert');
const EbyAsync = require('../../utils/ebyasync');
const IDiscordServerRepo = require('../../domain/repos/i_discord_server_repo');
const DiscordServer = require('../../domain/models/discord_server');

const cache = new Map();

class InmemoryDiscordServerCache {
    async loadOrCreate(id) {
        assert(typeof id === 'string');

        const maybeServer = cache.get(id);
        if (maybeServer) {
            let server = maybeServer;
            if (server.isInitializing) {
                const MAX = 100;
                let count = 0;
                while (count < MAX) {
                    count += 1;
                    await EbyAsync.sleep(100);
                    server = cache.get(id);
                    if (!server) {
                        logger.warn('初期化待ち中にサーバーが消えたので中断する', maybeServer);
                        // TODO FIX 中断エラー共通化
                        return Promise.reject(0);
                    }
                    if (!server.isInitializing) {
                        logger.info(`サーバーが初期化中だったので${count}回待った`);
                        break;
                    }
                }
                if (server.isInitializing) {
                    logger.warn(`${MAX}回待ったのに初期化が終わらなかったので中断する`, server);
                    // TODO FIX 中断エラー共通化
                    return Promise.reject(0);
                }
            }

            return Promise.resolve(server);
        } else {
            const newServer = new DiscordServer(id);
            cache.set(newServer.id, newServer);

            // TODO Init処理はうまいことなくせる気がする
            try {
                await newServer.init();
            } catch (err) {
                cache.set(newServer.id, null);
                logger.warn('初期化失敗', err);
                // TODO FIX 中断エラー共通化
                return Promise.reject(0);
            }

            return Promise.resolve(newServer);
        }
    }
}

IDiscordServerRepo.comprise(InmemoryDiscordServerCache);

module.exports = InmemoryDiscordServerCache;
