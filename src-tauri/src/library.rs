use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub title: String,
    pub style: String,
    pub lyrics: String,
    pub cot: String,
    pub seed: u64,
    pub length: String,
}

impl Draft {
    pub fn validate(&self) -> Result<(), String> {
        if self.title.trim().is_empty() || self.title.chars().count() > 100 {
            return Err("Give your song a title of up to 100 characters.".into());
        }
        if self.style.trim().is_empty() || self.style.chars().count() > 1000 {
            return Err("Describe the style in 1–1,000 characters.".into());
        }
        if self.lyrics.trim().is_empty() || self.lyrics.chars().count() > 6000 {
            return Err("Enter lyrics of up to 6,000 characters.".into());
        }
        if !self.lyrics.lines().any(|line| {
            let text = line.trim();
            !(text.is_empty() || text.starts_with('[') && text.ends_with(']'))
        }) {
            return Err("Add at least one line of lyrics after the section tags.".into());
        }
        if !["full", "melody", "off"].contains(&self.cot.as_str())
            || !["sketch", "standard", "extended"].contains(&self.length.as_str())
            || self.seed > 9_007_199_254_740_991
        {
            return Err("The generation settings are invalid.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: String,
    pub request: Draft,
    pub status: String,
    pub created: u64,
    pub duration: Option<f64>,
    pub truncated: bool,
    pub error: Option<String>,
    pub audio: Option<String>,
}

pub fn open(root: &Path) -> Result<Connection, String> {
    let db = Connection::open(root.join("studio.sqlite3")).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS songs (id TEXT PRIMARY KEY, created INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL);").map_err(|e| e.to_string())?;
    for mut song in list(&db)? {
        if song.status == "running" {
            song.status = "interrupted".into();
            song.error = Some(
                "The app closed during generation. Your request is saved; load it to try again."
                    .into(),
            );
            put(&db, &song)?;
        }
    }
    Ok(db)
}

pub fn put(db: &Connection, song: &Song) -> Result<(), String> {
    let json = serde_json::to_string(song).map_err(|e| e.to_string())?;
    let created = i64::try_from(song.created).map_err(|_| "Invalid creation date")?;
    db.execute("INSERT INTO songs(id,created,data) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![song.id, created, json]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list(db: &Connection) -> Result<Vec<Song>, String> {
    let mut query = db
        .prepare("SELECT data FROM songs ORDER BY created DESC, rowid DESC LIMIT 200")
        .map_err(|e| e.to_string())?;
    let rows = query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    })
    .collect()
}

pub fn get(db: &Connection, id: &str) -> Result<Song, String> {
    let json: String = db
        .query_row("SELECT data FROM songs WHERE id=?1", [id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn draft() -> Draft {
        Draft {
            title: "Test".into(),
            style: "Pop".into(),
            lyrics: "[Verse]\nHello".into(),
            cot: "full".into(),
            seed: 42,
            length: "standard".into(),
        }
    }
    #[test]
    fn invalid_requests_never_reach_engine() {
        let mut value = draft();
        assert!(value.validate().is_ok());
        value.cot = "shell-command".into();
        assert!(value.validate().is_err());
        value = draft();
        value.lyrics = " ".into();
        assert!(value.validate().is_err());
        value.lyrics = "[Verse]\n[Chorus]".into();
        assert!(value.validate().is_err());
        value = draft();
        value.seed = u64::MAX;
        assert!(value.validate().is_err());
    }
    #[test]
    fn restart_recovers_running_history_without_losing_request() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        let db = open(&root).unwrap();
        let song = Song {
            id: "run".into(),
            request: draft(),
            status: "running".into(),
            created: 1,
            duration: None,
            truncated: false,
            error: None,
            audio: None,
        };
        put(&db, &song).unwrap();
        drop(db);
        let db = open(&root).unwrap();
        let recovered = get(&db, "run").unwrap();
        assert_eq!(recovered.status, "interrupted");
        assert_eq!(recovered.request.lyrics, song.request.lyrics);
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }
}
