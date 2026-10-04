use cap_std::fs::Dir;
use std::path::{Path, PathBuf};

pub struct Folder {
    pub path: PathBuf,
    directory: Dir,
}

impl Folder {
    pub fn open(path: &Path) -> Result<Self, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let directory = Dir::open_ambient_dir(&path, cap_std::ambient_authority())
            .map_err(|e| e.to_string())?;
        Ok(Self { path, directory })
    }

    pub fn write_acceptance_report(&self, report: &str) -> Result<(), String> {
        use std::io::Write;
        let mut options = cap_std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = self
            .directory
            .open_with("native-report.json", &options)
            .map_err(|e| e.to_string())?;
        file.write_all(report.as_bytes()).map_err(|e| e.to_string())
    }
}

pub fn read(roots: &[Folder], path: &Path) -> Result<String, String> {
    let root = roots
        .iter()
        .find(|root| path.starts_with(&root.path))
        .ok_or("File is outside the selected folders")?;
    let relative = path.strip_prefix(&root.path).map_err(|e| e.to_string())?;
    root.directory
        .read_to_string(relative)
        .map_err(|e| e.to_string())
}

pub fn documents(root: &Folder) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    fn visit(root: &Folder, relative: &Path, files: &mut Vec<String>) -> Result<(), String> {
        let directory = if relative.as_os_str().is_empty() {
            Path::new(".")
        } else {
            relative
        };
        for entry in root
            .directory
            .read_dir(directory)
            .map_err(|e| e.to_string())?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let path = relative.join(entry.file_name());
            if kind.is_dir() {
                if !matches!(
                    entry.file_name().to_str(),
                    Some(".git" | "node_modules" | "target")
                ) {
                    visit(root, &path, files)?;
                }
            } else if kind.is_file() && path.extension().is_some_and(|e| e == "pfdsl") {
                files.push(root.path.join(path).to_string_lossy().into_owned());
            }
        }
        Ok(())
    }
    visit(root, Path::new(""), &mut files)?;
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[cfg(unix)]
    #[test]
    fn keeps_the_selected_folder_bound_when_its_path_is_replaced() {
        let root = std::env::temp_dir().join(format!(
            "pfdsl-foundation-replacement-{}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        let selected = root.join("selected");
        let outside = root.join("outside");
        fs::create_dir(&selected).unwrap();
        fs::create_dir(&outside).unwrap();
        let selected = selected.canonicalize().unwrap();
        let outside = outside.canonicalize().unwrap();
        fs::write(selected.join("a.pfdsl"), "selected content").unwrap();
        fs::write(outside.join("a.pfdsl"), "outside content").unwrap();
        let roots = vec![Folder::open(&selected).unwrap()];
        fs::rename(&selected, root.join("original")).unwrap();
        std::os::unix::fs::symlink(&outside, &selected).unwrap();
        assert_eq!(
            read(&roots, &selected.join("a.pfdsl")).unwrap(),
            "selected content"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_only_files_inside_user_selected_folders() {
        let root = std::env::temp_dir().join(format!("pfdsl-foundation-{}", std::process::id()));
        fs::create_dir_all(root.join("selected")).unwrap();
        let selected = root.join("selected").canonicalize().unwrap();
        let folder = Folder::open(&selected).unwrap();
        let inside = selected.join("a.pfdsl");
        let outside = root.join("outside.yaml");
        fs::write(&inside, "a >> p -> b").unwrap();
        fs::write(&outside, "secret").unwrap();
        assert_eq!(
            read(std::slice::from_ref(&folder), &inside).unwrap(),
            "a >> p -> b"
        );
        assert!(read(&[], &inside).is_err());
        assert!(read(std::slice::from_ref(&folder), &outside).is_err());
        assert!(read(
            std::slice::from_ref(&folder),
            &selected.join("../outside.yaml")
        )
        .is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, selected.join("escape.yaml")).unwrap();
            assert!(read(std::slice::from_ref(&folder), &selected.join("escape.yaml")).is_err());
            std::os::unix::fs::symlink(&outside, selected.join("escape.pfdsl")).unwrap();
        }
        assert_eq!(
            documents(&folder).unwrap(),
            vec![inside.to_string_lossy().into_owned()]
        );
        fs::remove_dir_all(root).unwrap();
    }
}
