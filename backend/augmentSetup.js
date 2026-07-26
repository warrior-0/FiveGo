const db = require('./db');
const { AUGMENT_CATALOG } = require('./augmentCatalog');

async function ensureAugmentColumn(columnName, ddl) {
    const [columns] = await db.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'augments'
           AND COLUMN_NAME = ?`,
        [columnName]
    );

    if (!columns.length) {
        await db.query(`ALTER TABLE augments ADD COLUMN ${ddl}`);
    }
}

async function syncAugments() {
    await ensureAugmentColumn('timing', "timing varchar(30) NOT NULL DEFAULT 'capture-first'");
    await ensureAugmentColumn('effect_key', "effect_key varchar(50) NOT NULL DEFAULT 'gain_one_on_captured'");

    const catalogCodes = AUGMENT_CATALOG.map((augment) => augment.code);
    const placeholders = catalogCodes.map(() => '?').join(',');
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        await conn.query(
            `DELETE ua FROM user_augments ua
             JOIN augments a ON a.id = ua.augment_id
             WHERE a.code NOT IN (${placeholders})`,
            catalogCodes
        );
        await conn.query(`DELETE FROM augments WHERE code NOT IN (${placeholders})`, catalogCodes);

        for (const augment of AUGMENT_CATALOG) {
            await conn.query(
                `INSERT INTO augments (code, name, description, timing, effect_key)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    name = VALUES(name),
                    description = VALUES(description),
                    timing = VALUES(timing),
                    effect_key = VALUES(effect_key)`,
                [augment.code, augment.name, augment.description, augment.timing, augment.effectKey]
            );
        }

        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = { syncAugments };
