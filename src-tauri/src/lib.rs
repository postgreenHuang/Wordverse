use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{collections::{HashMap, HashSet}, fs, io::Write, path::{Path, PathBuf}, sync::{OnceLock, RwLock}, time::{SystemTime, UNIX_EPOCH}};

const PROJECT_FORMAT_VERSION: u64 = 1;
static ACTIVE_PROJECT_ROOT: OnceLock<RwLock<PathBuf>> = OnceLock::new();

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectManifest { project_format_version: u64, project_id: String, name: String, created_at: String, #[serde(default)] legacy_layout: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectInfo { project_id: String, name: String, path: String, legacy: bool }

fn default_project_dir() -> Result<PathBuf, String> {
  let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).ok_or("cannot_resolve_user_directory")?;
  Ok(PathBuf::from(home).join(".Wordverse"))
}

fn active_project_lock() -> Result<&'static RwLock<PathBuf>, String> {
  if let Some(lock) = ACTIVE_PROJECT_ROOT.get() { return Ok(lock); }
  let root = default_project_dir()?;
  let _ = ACTIVE_PROJECT_ROOT.set(RwLock::new(root));
  ACTIVE_PROJECT_ROOT.get().ok_or_else(|| "project_context_unavailable".into())
}

fn wordverse_dir() -> Result<PathBuf, String> {
  active_project_lock()?.read().map(|root| root.clone()).map_err(|_| "project_context_poisoned".into())
}

fn iso_timestamp() -> Result<String, String> {
  let millis = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| format!("clock_failed: {error}"))?.as_millis();
  Ok(millis.to_string())
}

fn manifest_path(root: &Path) -> PathBuf { root.join(".wordverse-project.json") }

fn find_parent_project(root: &Path) -> bool {
  root.parent().into_iter().flat_map(Path::ancestors).any(|parent| manifest_path(parent).is_file())
}

fn validate_legacy_project(root: &Path) -> Result<(), String> {
  let settings = root.join("settings.json");
  if settings.is_file() {
    let raw = fs::read_to_string(&settings).map_err(|error| format!("settings_read_failed: {error}"))?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid_settings_json: {error}"))?;
    let files = value.get("graphFiles").and_then(Value::as_object).ok_or("invalid_graph_index")?;
    for filename in files.values().filter_map(Value::as_str) {
      if Path::new(filename).components().count() != 1 { return Err("invalid_graph_filename".into()); }
      let raw = fs::read_to_string(root.join("词网").join(filename)).map_err(|error| format!("graph_read_failed: {error}"))?;
      serde_json::from_str::<Value>(&raw).map_err(|error| format!("invalid_graph_json: {error}"))?;
    }
    return Ok(());
  }
  let workspace = root.join("workspace.json");
  let raw = fs::read_to_string(workspace).map_err(|error| format!("workspace_read_failed: {error}"))?;
  let value: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid_workspace_json: {error}"))?;
  if value.get("schemaVersion").and_then(Value::as_u64) != Some(1) { return Err("unsupported_schema_version".into()); }
  Ok(())
}
fn read_project(root: &Path) -> Result<ProjectInfo, String> {
  if !root.is_dir() { return Err("project_directory_missing".into()); }
  let canonical = fs::canonicalize(root).map_err(|error| format!("project_path_failed: {error}"))?;
  let manifest_file = manifest_path(&canonical);
  let legacy = !manifest_file.exists() && (canonical.join("settings.json").is_file() || canonical.join("workspace.json").is_file());
  if !manifest_file.exists() && !legacy { return Err("not_wordverse_project".into()); }
  let manifest = if legacy {
    let stamp = iso_timestamp()?;
    validate_legacy_project(&canonical)?;
    let manifest = ProjectManifest { project_format_version: PROJECT_FORMAT_VERSION, project_id: format!("legacy-{stamp}"), name: canonical.file_name().and_then(|name| name.to_str()).unwrap_or("Wordverse").to_string(), created_at: stamp, legacy_layout: true };
    write_atomic(&manifest_file, &serde_json::to_string_pretty(&manifest).map_err(|error| format!("manifest_serialize_failed: {error}"))?)?;
    manifest
  } else {
    let raw = fs::read_to_string(&manifest_file).map_err(|error| format!("manifest_read_failed: {error}"))?;
    let manifest: ProjectManifest = serde_json::from_str(&raw).map_err(|error| format!("manifest_invalid: {error}"))?;
    if manifest.project_format_version != PROJECT_FORMAT_VERSION || manifest.project_id.trim().is_empty() || manifest.name.trim().is_empty() { return Err("manifest_invalid".into()); }
    manifest
  };
  let legacy_layout = manifest.legacy_layout;
  Ok(ProjectInfo { project_id: manifest.project_id, name: manifest.name, path: canonical.to_string_lossy().into_owned(), legacy: legacy_layout })
}

fn workspace_path() -> Result<PathBuf, String> { Ok(wordverse_dir()?.join("workspace.json")) }
fn settings_path() -> Result<PathBuf, String> { Ok(wordverse_dir()?.join("settings.json")) }
fn graphs_dir() -> Result<PathBuf, String> { Ok(wordverse_dir()?.join("词网")) }
fn backups_dir() -> Result<PathBuf, String> {
  let root = wordverse_dir()?;
  let legacy = fs::read_to_string(manifest_path(&root)).ok().and_then(|raw| serde_json::from_str::<ProjectManifest>(&raw).ok()).map(|manifest| manifest.legacy_layout).unwrap_or(true);
  Ok(if legacy { root.join("备份") } else { root.join(".wordverse").join("backups") })
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
  if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) { return Some("png"); }
  if bytes.starts_with(&[0xff, 0xd8, 0xff]) { return Some("jpg"); }
  if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" { return Some("webp"); }
  if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { return Some("gif"); }
  None
}

fn base64_encode(bytes: &[u8]) -> String {
  const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
  for chunk in bytes.chunks(3) {
    let value = ((chunk[0] as u32) << 16) | ((chunk.get(1).copied().unwrap_or(0) as u32) << 8) | chunk.get(2).copied().unwrap_or(0) as u32;
    output.push(TABLE[((value >> 18) & 63) as usize] as char);
    output.push(TABLE[((value >> 12) & 63) as usize] as char);
    output.push(if chunk.len() > 1 { TABLE[((value >> 6) & 63) as usize] as char } else { '=' });
    output.push(if chunk.len() > 2 { TABLE[(value & 63) as usize] as char } else { '=' });
  }
  output
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
  if input.is_empty() || input.len() % 4 != 0 { return Err("invalid_base64".into()); }
  let decode = |byte: u8| -> Result<u8, String> { match byte {
    b'A'..=b'Z' => Ok(byte - b'A'), b'a'..=b'z' => Ok(byte - b'a' + 26), b'0'..=b'9' => Ok(byte - b'0' + 52), b'+' => Ok(62), b'/' => Ok(63), _ => Err("invalid_base64".into())
  }};
  let mut output = Vec::with_capacity(input.len() / 4 * 3);
  for chunk in input.as_bytes().chunks_exact(4) {
    let a = decode(chunk[0])? as u32;
    let b = decode(chunk[1])? as u32;
    let c = if chunk[2] == b'=' { 0 } else { decode(chunk[2])? as u32 };
    let d = if chunk[3] == b'=' { 0 } else { decode(chunk[3])? as u32 };
    if chunk[2] == b'=' && chunk[3] != b'=' { return Err("invalid_base64_padding".into()); }
    let value = (a << 18) | (b << 12) | (c << 6) | d;
    output.push((value >> 16) as u8);
    if chunk[2] != b'=' { output.push((value >> 8) as u8); }
    if chunk[3] != b'=' { output.push(value as u8); }
  }
  Ok(output)
}

fn persist_image_asset_to(bytes: &[u8], directory: &Path) -> Result<String, String> {
  if bytes.is_empty() || bytes.len() > 12 * 1024 * 1024 { return Err("image_size_invalid".into()); }
  let extension = image_extension(bytes).ok_or("unsupported_image_format")?;
  fs::create_dir_all(&directory).map_err(|error| format!("asset_directory_failed: {error}"))?;
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| format!("clock_failed: {error}"))?.as_nanos();
  let name = format!("image-{stamp}.{extension}");
  let path = directory.join(&name);
  let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|error| format!("asset_file_failed: {error}"))?;
  file.write_all(bytes).map_err(|error| format!("asset_write_failed: {error}"))?;
  file.sync_all().map_err(|error| format!("asset_flush_failed: {error}"))?;
  Ok(format!("asset:{name}"))
}

fn persist_image_asset(bytes: &[u8]) -> Result<String, String> { persist_image_asset_to(bytes, &wordverse_dir()?.join("assets")) }

fn externalize_data_images(value: &mut Value, asset_directory: &Path) -> Result<(), String> {
  match value {
    Value::String(contents) if contents.starts_with("data:image/") => {
      let (_, encoded) = contents.split_once(";base64,").ok_or("unsupported_image_data_url")?;
      *contents = persist_image_asset_to(&base64_decode(encoded)?, asset_directory)?;
    }
    Value::Array(items) => for item in items { externalize_data_images(item, asset_directory)?; },
    Value::Object(entries) => for item in entries.values_mut() { externalize_data_images(item, asset_directory)?; },
    _ => {}
  }
  Ok(())
}

fn inline_asset_references(value: &mut Value, asset_directory: &Path) -> Result<(), String> {
  match value {
    Value::String(reference) if reference.starts_with("asset:") => {
      let name = reference.strip_prefix("asset:").ok_or("invalid_asset_reference")?;
      if name.is_empty() || Path::new(name).components().count() != 1 { return Err("invalid_asset_reference".into()); }
      let bytes = fs::read(asset_directory.join(name)).map_err(|error| format!("asset_read_failed: {error}"))?;
      let extension = image_extension(&bytes).ok_or("unsupported_image_format")?;
      let mime = match extension { "jpg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", "gif" => "image/gif", _ => return Err("unsupported_image_format".into()) };
      *reference = format!("data:{mime};base64,{}", base64_encode(&bytes));
    }
    Value::Array(items) => for item in items { inline_asset_references(item, asset_directory)?; },
    Value::Object(entries) => for item in entries.values_mut() { inline_asset_references(item, asset_directory)?; },
    _ => {}
  }
  Ok(())
}

fn document_revision(contents: &str) -> Option<u64> {
  serde_json::from_str::<Value>(contents).ok()?.get("revision")?.as_u64()
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
  let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
  let destination_wide: Vec<u16> = destination.as_os_str().encode_wide().chain(Some(0)).collect();
  let result = unsafe { MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
  if result == 0 { Err(format!("atomic_replace_failed: {}", std::io::Error::last_os_error())) } else { Ok(()) }
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
  fs::rename(source, destination).map_err(|error| format!("atomic_replace_failed: {error}"))
}

fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
  let directory = path.parent().ok_or("invalid_workspace_path")?;
  fs::create_dir_all(directory).map_err(|error| format!("workspace_directory_failed: {error}"))?;
  let temporary = path.with_extension("json.tmp");
  let mut file = fs::File::create(&temporary).map_err(|error| format!("temporary_file_failed: {error}"))?;
  file.write_all(contents.as_bytes()).map_err(|error| format!("workspace_write_failed: {error}"))?;
  file.sync_all().map_err(|error| format!("workspace_flush_failed: {error}"))?;
  atomic_replace(&temporary, path)
}

fn rotate_backups(contents: &str) -> Result<(), String> {
  let directory = backups_dir()?;
  fs::create_dir_all(&directory).map_err(|error| format!("backup_directory_failed: {error}"))?;
  let backup = |slot: u8| directory.join(format!("workspace.backup-{slot}.json"));
  if backup(3).exists() { fs::remove_file(backup(3)).map_err(|error| format!("backup_cleanup_failed: {error}"))?; }
  if backup(2).exists() { fs::rename(backup(2), backup(3)).map_err(|error| format!("backup_rotation_failed: {error}"))?; }
  if backup(1).exists() { fs::rename(backup(1), backup(2)).map_err(|error| format!("backup_rotation_failed: {error}"))?; }
  write_atomic(&backup(1), contents)
}

fn safe_graph_filename(name: &str, used: &mut HashSet<String>) -> String {
  let cleaned: String = name.chars().map(|character| if "<>:\"/\\|?*".contains(character) || character.is_control() { '_' } else { character }).collect();
  let base = cleaned.trim().trim_matches('.');
  let base = if base.is_empty() { "未命名词网" } else { base };
  let mut candidate = format!("{base}.json");
  let mut suffix = 2;
  while used.contains(&candidate.to_lowercase()) { candidate = format!("{base} ({suffix}).json"); suffix += 1; }
  used.insert(candidate.to_lowercase());
  candidate
}

fn collect_child_graphs(graph_id: &str, all: &Map<String, Value>, output: &mut Map<String, Value>, visited: &mut HashSet<String>) {
  if !visited.insert(graph_id.to_string()) { return; }
  let Some(graph) = all.get(graph_id) else { return; };
  output.insert(graph_id.to_string(), graph.clone());
  if let Some(nodes) = graph.get("nodes").and_then(Value::as_array) {
    for node in nodes {
      if let Some(id) = node.get("id").and_then(Value::as_str) { collect_child_graphs(&format!("child:{id}"), all, output, visited); }
    }
  }
}

fn load_split_workspace() -> Result<Option<String>, String> {
  let path = settings_path()?;
  if !path.exists() { return Ok(None); }
  let raw = fs::read_to_string(&path).map_err(|error| format!("settings_read_failed: {error}"))?;
  let settings: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid_settings_json: {error}"))?;
  let files = settings.get("graphFiles").and_then(Value::as_object).ok_or("invalid_graph_index")?;
  let mut graphs = Map::new();
  for filename in files.values().filter_map(Value::as_str) {
    if Path::new(filename).components().count() != 1 { return Err("invalid_graph_filename".into()); }
    let package_raw = fs::read_to_string(graphs_dir()?.join(filename)).map_err(|error| format!("graph_read_failed: {error}"))?;
    let package: Value = serde_json::from_str(&package_raw).map_err(|error| format!("invalid_graph_json: {error}"))?;
    if let Some(entries) = package.get("graphs").and_then(Value::as_object) {
      for (id, graph) in entries { graphs.insert(id.clone(), graph.clone()); }
    }
  }
  let mut document = Map::new();
  document.insert("schemaVersion".into(), settings.get("schemaVersion").cloned().unwrap_or(Value::from(1)));
  document.insert("revision".into(), settings.get("revision").cloned().unwrap_or(Value::from(0)));
  document.insert("updatedAt".into(), settings.get("updatedAt").cloned().unwrap_or(Value::String(String::new())));
  document.insert("globalProperties".into(), settings.get("globalProperties").cloned().unwrap_or(Value::Array(Vec::new())));
  document.insert("graphs".into(), Value::Object(graphs));
  serde_json::to_string_pretty(&Value::Object(document)).map(Some).map_err(|error| format!("workspace_serialize_failed: {error}"))
}

fn write_split_workspace(value: &Value) -> Result<(), String> {
  let all = value.get("graphs").and_then(Value::as_object).ok_or("invalid_graph_collection")?;
  let directory = graphs_dir()?;
  fs::create_dir_all(&directory).map_err(|error| format!("graph_directory_failed: {error}"))?;
  let previous_files: HashMap<String, String> = settings_path()?.exists()
    .then(|| fs::read_to_string(settings_path().ok()?).ok())
    .flatten().and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
    .and_then(|settings| settings.get("graphFiles").and_then(Value::as_object).cloned())
    .map(|entries| entries.into_iter().filter_map(|(id, file)| file.as_str().map(|name| (id, name.to_string()))).collect()).unwrap_or_default();
  let mut used = HashSet::new();
  let mut graph_files = Map::new();
  for (main_id, graph) in all.iter().filter(|(id, _)| *id == "root" || id.starts_with("graph:")) {
    let name = graph.get("name").and_then(Value::as_str).unwrap_or("未命名词网");
    let desired = safe_graph_filename(name, &mut used);
    let filename = previous_files.get(main_id).filter(|old| old.eq_ignore_ascii_case(&desired)).cloned().unwrap_or(desired);
    let mut subset = Map::new();
    collect_child_graphs(main_id, all, &mut subset, &mut HashSet::new());
    let package = serde_json::json!({ "schemaVersion": 1, "mainGraphId": main_id, "name": name, "graphs": subset });
    write_atomic(&directory.join(&filename), &serde_json::to_string_pretty(&package).map_err(|error| format!("graph_serialize_failed: {error}"))?)?;
    graph_files.insert(main_id.clone(), Value::String(filename));
  }
  let settings = serde_json::json!({
    "schemaVersion": 1,
    "revision": value.get("revision").cloned().unwrap_or(Value::from(0)),
    "updatedAt": value.get("updatedAt").cloned().unwrap_or(Value::String(String::new())),
    "globalProperties": value.get("globalProperties").cloned().unwrap_or(Value::Array(Vec::new())),
    "graphFiles": graph_files
  });
  write_atomic(&settings_path()?, &serde_json::to_string_pretty(&settings).map_err(|error| format!("settings_serialize_failed: {error}"))?)?;
  let active: HashSet<String> = settings.get("graphFiles").and_then(Value::as_object).into_iter().flatten().filter_map(|(_, value)| value.as_str().map(str::to_lowercase)).collect();
  for old in previous_files.values() {
    if !active.contains(&old.to_lowercase()) { let path = directory.join(old); if path.is_file() { fs::remove_file(path).map_err(|error| format!("stale_graph_cleanup_failed: {error}"))?; } }
  }
  Ok(())
}

fn migrate_legacy_workspace_files() -> Result<(), String> {
  let root = wordverse_dir()?;
  let backup_directory = backups_dir()?;
  fs::create_dir_all(&backup_directory).map_err(|error| format!("backup_directory_failed: {error}"))?;
  let workspace = root.join("workspace.json");
  if workspace.exists() {
    let destination = backup_directory.join("legacy-workspace.json");
    if destination.exists() { fs::remove_file(&workspace).map_err(|error| format!("legacy_cleanup_failed: {error}"))?; }
    else { fs::rename(&workspace, destination).map_err(|error| format!("legacy_migration_failed: {error}"))?; }
  }
  for slot in 1..=3 {
    let source = root.join(format!("workspace.backup-{slot}.json"));
    if !source.exists() { continue; }
    let destination = backup_directory.join(format!("legacy-workspace.backup-{slot}.json"));
    if destination.exists() { fs::remove_file(source).map_err(|error| format!("legacy_backup_cleanup_failed: {error}"))?; }
    else { fs::rename(source, destination).map_err(|error| format!("legacy_backup_migration_failed: {error}"))?; }
  }
  Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceBackup { id: String, revision: u64, updated_at: String }

#[tauri::command]
fn default_project() -> Result<Option<ProjectInfo>, String> {
  let root = default_project_dir()?;
  if !root.is_dir() { return Ok(None); }
  match read_project(&root) { Ok(project) => Ok(Some(project)), Err(error) if error == "not_wordverse_project" => Ok(None), Err(error) => Err(error) }
}

#[tauri::command]
fn activate_project(path: String) -> Result<ProjectInfo, String> {
  let project = read_project(Path::new(&path))?;
  let canonical = PathBuf::from(&project.path);
  let lock = active_project_lock()?;
  *lock.write().map_err(|_| "project_context_poisoned".to_string())? = canonical;
  Ok(project)
}

#[tauri::command]
fn create_project(path: String, name: String) -> Result<ProjectInfo, String> {
  let name = name.trim();
  if name.is_empty() { return Err("project_name_required".into()); }
  let requested = PathBuf::from(path);
  fs::create_dir_all(&requested).map_err(|error| format!("project_create_failed: {error}"))?;
  let root = fs::canonicalize(&requested).map_err(|error| format!("project_path_failed: {error}"))?;
  if find_parent_project(&root) { return Err("nested_project_not_allowed".into()); }
  if manifest_path(&root).exists() || root.join("settings.json").exists() || root.join("词网").exists() { return Err("project_already_exists".into()); }
  let mut entries = fs::read_dir(&root).map_err(|error| format!("project_read_failed: {error}"))?;
  if entries.next().is_some() { return Err("project_directory_not_empty".into()); }
  let stamp = iso_timestamp()?;
  let manifest = ProjectManifest { project_format_version: PROJECT_FORMAT_VERSION, project_id: format!("project-{}-{}", std::process::id(), stamp), name: name.to_string(), created_at: stamp, legacy_layout: false };
  write_atomic(&manifest_path(&root), &serde_json::to_string_pretty(&manifest).map_err(|error| format!("manifest_serialize_failed: {error}"))?)?;
  fs::create_dir_all(root.join("词网")).map_err(|error| format!("graph_directory_failed: {error}"))?;
  fs::create_dir_all(root.join("assets")).map_err(|error| format!("asset_directory_failed: {error}"))?;
  fs::create_dir_all(root.join(".wordverse").join("backups")).map_err(|error| format!("backup_directory_failed: {error}"))?;
  fs::create_dir_all(root.join(".wordverse").join("conflicts")).map_err(|error| format!("conflict_directory_failed: {error}"))?;
  let project = read_project(&root)?;
  let lock = active_project_lock()?;
  *lock.write().map_err(|_| "project_context_poisoned".to_string())? = root;
  Ok(project)
}
#[tauri::command]
fn load_workspace() -> Result<Option<String>, String> {
  if let Some(document) = load_split_workspace()? { return Ok(Some(document)); }
  let path = workspace_path()?;
  if !path.exists() { return Ok(None); }
  fs::read_to_string(path).map(Some).map_err(|error| format!("workspace_read_failed: {error}"))
}

#[tauri::command]
fn save_workspace(document: String, expected_revision: u64) -> Result<(), String> {
  let parsed: Value = serde_json::from_str(&document).map_err(|error| format!("invalid_workspace_json: {error}"))?;
  if parsed.get("schemaVersion").and_then(Value::as_u64) != Some(1) { return Err("unsupported_schema_version".into()); }
  let current_document = load_split_workspace()?.or_else(|| fs::read_to_string(workspace_path().ok()?).ok());
  if let Some(current) = &current_document {
    if document_revision(&current) != Some(expected_revision) { return Err("storage_conflict".into()); }
  }
  if let Some(current) = current_document { rotate_backups(&current)?; }
  write_split_workspace(&parsed)?;
  migrate_legacy_workspace_files()?;
  Ok(())
}

#[tauri::command]
fn list_workspace_backups() -> Result<Vec<WorkspaceBackup>, String> {
  let directory = backups_dir()?;
  let mut backups = Vec::new();
  for slot in 1..=3 {
    let path = directory.join(format!("workspace.backup-{slot}.json"));
    if !path.exists() { continue; }
    let raw = fs::read_to_string(path).map_err(|error| format!("backup_read_failed: {error}"))?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid_backup_json: {error}"))?;
    backups.push(WorkspaceBackup {
      id: slot.to_string(),
      revision: value.get("revision").and_then(Value::as_u64).unwrap_or(0),
      updated_at: value.get("updatedAt").and_then(Value::as_str).unwrap_or("").to_string(),
    });
  }
  backups.sort_by(|a, b| b.revision.cmp(&a.revision));
  Ok(backups)
}

#[tauri::command]
fn restore_workspace_backup(slot: u8, updated_at: String) -> Result<String, String> {
  if !(1..=3).contains(&slot) { return Err("invalid_backup_slot".into()); }
  let directory = backups_dir()?;
  let backup_path = directory.join(format!("workspace.backup-{slot}.json"));
  let raw = fs::read_to_string(backup_path).map_err(|error| format!("backup_read_failed: {error}"))?;
  let mut value: Value = serde_json::from_str(&raw).map_err(|error| format!("invalid_backup_json: {error}"))?;
  let current_raw = load_split_workspace()?.or_else(|| fs::read_to_string(workspace_path().ok()?).ok());
  let current_revision = current_raw.as_deref().and_then(document_revision).unwrap_or(0);
  value["revision"] = Value::from(current_revision + 1);
  value["updatedAt"] = Value::from(updated_at);
  let restored = serde_json::to_string_pretty(&value).map_err(|error| format!("backup_serialize_failed: {error}"))?;
  if let Some(current) = current_raw { rotate_backups(&current)?; }
  write_split_workspace(&value)?;
  Ok(restored)
}

#[tauri::command]
fn save_conflict_copy(document: String) -> Result<String, String> {
  let value: Value = serde_json::from_str(&document).map_err(|error| format!("invalid_workspace_json: {error}"))?;
  if value.get("schemaVersion").and_then(Value::as_u64) != Some(1) { return Err("unsupported_schema_version".into()); }
  let root = wordverse_dir()?;
  let legacy = fs::read_to_string(manifest_path(&root)).ok().and_then(|raw| serde_json::from_str::<ProjectManifest>(&raw).ok()).map(|manifest| manifest.legacy_layout).unwrap_or(true);
  let directory = if legacy { root.join("conflicts") } else { root.join(".wordverse").join("conflicts") };
  fs::create_dir_all(&directory).map_err(|error| format!("conflict_directory_failed: {error}"))?;
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| format!("clock_failed: {error}"))?.as_millis();
  let name = format!("workspace-conflict-{stamp}.json");
  let path = directory.join(&name);
  let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|error| format!("conflict_file_failed: {error}"))?;
  file.write_all(document.as_bytes()).map_err(|error| format!("conflict_write_failed: {error}"))?;
  file.sync_all().map_err(|error| format!("conflict_flush_failed: {error}"))?;
  Ok(format!("conflicts/{name}"))
}

#[tauri::command]
fn save_image_asset(bytes: Vec<u8>) -> Result<String, String> {
  persist_image_asset(&bytes)
}

#[tauri::command]
fn resolve_image_asset(reference: String) -> Result<String, String> {
  let name = reference.strip_prefix("asset:").ok_or("invalid_asset_reference")?;
  if name.is_empty() || Path::new(name).components().count() != 1 { return Err("invalid_asset_reference".into()); }
  let path = wordverse_dir()?.join("assets").join(name);
  if !path.is_file() { return Err("asset_missing".into()); }
  Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_workspace_document(document: String) -> Result<String, String> {
  let mut value: Value = serde_json::from_str(&document).map_err(|error| format!("invalid_workspace_json: {error}"))?;
  if value.get("schemaVersion").and_then(Value::as_u64) != Some(1) { return Err("unsupported_schema_version".into()); }
  inline_asset_references(&mut value, &wordverse_dir()?.join("assets"))?;
  serde_json::to_string_pretty(&value).map_err(|error| format!("workspace_export_failed: {error}"))
}

#[tauri::command]
fn import_workspace_document(document: String) -> Result<String, String> {
  let mut value: Value = serde_json::from_str(&document).map_err(|error| format!("invalid_workspace_json: {error}"))?;
  if value.get("schemaVersion").and_then(Value::as_u64) != Some(1) { return Err("unsupported_schema_version".into()); }
  externalize_data_images(&mut value, &wordverse_dir()?.join("assets"))?;
  serde_json::to_string_pretty(&value).map_err(|error| format!("workspace_import_failed: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![default_project, activate_project, create_project, load_workspace, save_workspace, list_workspace_backups, restore_workspace_backup, save_conflict_copy, save_image_asset, resolve_image_asset, export_workspace_document, import_workspace_document])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::image_extension;
  use std::collections::HashSet;

  #[test]
  fn detects_supported_raster_images_from_content() {
    assert_eq!(image_extension(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]), Some("png"));
    assert_eq!(image_extension(&[0xff, 0xd8, 0xff, 0x00]), Some("jpg"));
    assert_eq!(image_extension(b"GIF89a"), Some("gif"));
    assert_eq!(image_extension(b"RIFF1234WEBP"), Some("webp"));
  }

  #[test]
  fn rejects_extensions_disguised_as_images() {
    assert_eq!(image_extension(b"<svg><script/></svg>"), None);
    assert_eq!(image_extension(b"not an image"), None);
  }

  #[test]
  fn encodes_base64_with_standard_padding() {
    assert_eq!(super::base64_encode(b"Wordverse"), "V29yZHZlcnNl");
    assert_eq!(super::base64_encode(b"W"), "Vw==");
    assert_eq!(super::base64_encode(b"Wo"), "V28=");
  }

  #[test]
  fn decodes_base64_with_standard_padding() {
    assert_eq!(super::base64_decode("V29yZHZlcnNl").unwrap(), b"Wordverse");
    assert_eq!(super::base64_decode("Vw==").unwrap(), b"W");
    assert_eq!(super::base64_decode("V28=").unwrap(), b"Wo");
    assert!(super::base64_decode("bad").is_err());
  }

  #[test]
  fn portable_image_round_trip_uses_a_relative_asset_reference() {
    let directory = std::env::temp_dir().join(format!("wordverse-assets-test-{}", std::process::id()));
    let png = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let original = format!("data:image/png;base64,{}", super::base64_encode(&png));
    let mut value = serde_json::json!({ "image": original });
    super::externalize_data_images(&mut value, &directory).unwrap();
    assert!(value["image"].as_str().unwrap().starts_with("asset:image-"));
    super::inline_asset_references(&mut value, &directory).unwrap();
    assert_eq!(value["image"], original);
    std::fs::remove_dir_all(directory).unwrap();
  }

  #[test]
  fn graph_filenames_are_readable_safe_and_unique() {
    let mut used = HashSet::new();
    assert_eq!(super::safe_graph_filename("学习:英语", &mut used), "学习_英语.json");
    assert_eq!(super::safe_graph_filename("学习:英语", &mut used), "学习_英语 (2).json");
    assert_eq!(super::safe_graph_filename("...", &mut used), "未命名词网.json");
  }

  #[test]
  fn main_graph_package_keeps_its_child_subtree_only() {
    let all = serde_json::json!({
      "root": { "nodes": [{ "id": "a" }] },
      "child:a": { "nodes": [{ "id": "nested" }] },
      "child:nested": { "nodes": [] },
      "graph:other": { "nodes": [] }
    }).as_object().unwrap().clone();
    let mut output = serde_json::Map::new();
    super::collect_child_graphs("root", &all, &mut output, &mut HashSet::new());
    assert!(output.contains_key("root"));
    assert!(output.contains_key("child:a"));
    assert!(output.contains_key("child:nested"));
    assert!(!output.contains_key("graph:other"));
  }
}
