const Interface = require('../../core/interface');

/** @typedef {import('../entity/voice_status')} VoiceStatus */

/**
 * 花子の音声ステータスリポジトリ
 */
class IVoiceStatusRepo extends Interface {
    /**
     * VoiceStatusを読み出し
     * - 花子が音声接続していない場合はnull
     *
     * @param {string} serverId DiscordサーバーID
     * @returns {Promise<VoiceStatus>|Promise<null>} 対象Discordサーバーの音声ステータス またはnull
     */
    async loadVoiceStatus(serverId) {}
}

module.exports = IVoiceStatusRepo;
