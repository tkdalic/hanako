const path = require('path');
const logger = require('log4js').getLogger(path.basename(__filename));
const RecoveryService = require('../service/recovery_service');
const RecoverySupervisor = require('../service/recovery_supervisor');

/** @typedef {import('discord.js').Client} discord.Client */
/** @typedef {import('discord.js').Message} discord.Message */

/**
 * Readyコントローラ
 * Discordのreadyイベントに対応する
 */
class ReadyCtrl {
    /**
     * @param {discord.Client} client Discord Botのクライアント
     */
    constructor(client) {
        this.client = client;
        this.recoveryService = new RecoveryService();
        this.recoverySupervisor = new RecoverySupervisor();

        logger.trace('セットアップ完了');
    }

    /**
     * on('ready')イベント
     */
    async onReady() {
        logger.info(`Logged in as ${this.client.user.tag}!`);

        // ボイスチャット復帰サービスを実行
        await this.recoveryService.serve();

        // ボイスチャット復帰の監督を開始
        await this.recoverySupervisor.supervise();
    }
}

module.exports = ReadyCtrl;
