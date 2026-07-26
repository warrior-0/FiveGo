const db = require('./db');

async function getAugmentColumns() {
    const [columns] = await db.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'augments'`
    );

    return new Set(columns.map((column) => column.COLUMN_NAME));
}

async function syncAugmentSchema() {
    const columns = await getAugmentColumns();

    if (!columns.has('timing')) {
        await db.query("ALTER TABLE augments ADD COLUMN timing varchar(30) NOT NULL DEFAULT 'capture-first'");
    }

    if (!columns.has('effect')) {
        await db.query("ALTER TABLE augments ADD COLUMN effect varchar(50) NOT NULL DEFAULT 'gain_one_on_captured'");
    }

    if (columns.has('effect_key')) {
        await db.query('ALTER TABLE augments DROP COLUMN effect_key');
    }

    if (columns.has('code')) {
        await db.query('ALTER TABLE augments DROP COLUMN code');
    }
}

module.exports = { syncAugmentSchema };
