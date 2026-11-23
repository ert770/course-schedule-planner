// Local empty-database bootstrap. Never reads .env; never drops or alters existing tables.
import mysql from 'mysql2/promise';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export async function initializeEmptyDatabase(connection) {
  const [existing] = await connection.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() LIMIT 1');
  if (existing.length) throw Error('DATABASE_NOT_EMPTY');
  await connection.query(`CREATE TABLE User_Profiles(user_id INT PRIMARY KEY,name VARCHAR(80),department VARCHAR(100),grade_level INT,class_name VARCHAR(100),profile_schema_version INT NOT NULL DEFAULT 1,preference_tags JSON,avoid_time JSON,max_credits INT,program_type VARCHAR(50),enrolled_programs JSON,college VARCHAR(80)) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE Courses(course_id VARCHAR(80) PRIMARY KEY,name VARCHAR(100),credits DECIMAL(4,1),type VARCHAR(50),dept VARCHAR(100),subid3 VARCHAR(45),target_grade INT,prerequisites TEXT) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE Course_Syllabi(source_key CHAR(64) PRIMARY KEY,course_code VARCHAR(45),academic_year SMALLINT UNSIGNED,semester TINYINT UNSIGNED) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE Course_Sections(section_id INT PRIMARY KEY,course_id VARCHAR(80),teacher VARCHAR(80),room VARCHAR(80),time_str VARCHAR(80),time_bitmask VARCHAR(80),year INT,semester INT,current_student INT,rag_context TEXT,rag_tag TEXT,selection_code VARCHAR(80),limit_student INT,has_midterm INT,has_final INT,has_teamwork INT,has_presentation INT,is_english_taught INT,assessment_summary TEXT) ENGINE=InnoDB`);
  await connection.query(`CREATE TABLE Course_Reviews(Reviews_id INT PRIMARY KEY,selection_code VARCHAR(80),Reviews_tags TEXT,Review_content TEXT,sweetness INT,coolness INT,workload INT,value INT,overall INT,review_count INT,source VARCHAR(50),url TEXT,scraped_at DATETIME) ENGINE=InnoDB`);
  const files=['002_privacy-foundation.up.sql','003_interaction-events.up.sql','004_course-history-v1.up.sql','005_admission-year.up.sql','006_learned-preference-weights.up.sql','007_saved-schedules-and-profile-extras.up.sql','008_tag-interest-profile.up.sql','009_course-neighbors.up.sql'];
  for (const file of files) {
    let sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');
    if(file.startsWith('004_'))sql=sql.replace('`User_Course_History_v1_new`','`User_Course_History`');
    for(const statement of sql.replace(/^\s*--.*$/gm,'').split(';').map(s=>s.trim()).filter(Boolean))await connection.query(statement);
  }
  // 010's guarded DELIMITER procedure cannot be sent through mysql2. The empty-schema
  // check above supplies its preflight; apply its two DDL statements directly.
  await connection.query('ALTER TABLE User_Profiles ADD COLUMN student_id VARCHAR(32) NULL, ADD UNIQUE KEY uq_user_profiles_student_id (student_id)');
  await connection.query('CREATE TABLE User_Id_Allocator(user_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB AUTO_INCREMENT=5');
  for(const file of ['011_history-source-credit.up.sql','012_local_history_attestation.up.sql','013_history_course_match.up.sql','014_unmatched_source_identity.up.sql','015_history_source_course_code.up.sql']) {
    const sql=(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')).replace(/^\s*--.*$/gm,'');
    for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(statement);
  }
}

if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  const {DB_HOST,DB_PORT,DB_USER,DB_PASSWORD,DB_NAME}=process.env;
  const port=Number(DB_PORT);
  if(DB_HOST!=='127.0.0.1'||!/^\d{1,5}$/.test(DB_PORT??'')||!Number.isInteger(port)||port<1024||port>65535||!DB_USER||DB_USER.toLowerCase()==='root'||!DB_PASSWORD||!/^csp_local_[a-z0-9_]+$/.test(DB_NAME??''))throw Error('LOCAL_DATABASE_GUARD');
  let connection;
  try { connection=await mysql.createConnection({host:DB_HOST,port,user:DB_USER,password:DB_PASSWORD,database:DB_NAME});await initializeEmptyDatabase(connection);console.log('已初始化本機空資料庫；請另行匯入授權的課程及開課資料。'); }
  catch { console.error('初始化失敗；DDL 可能已建立部分資料表，請檢查此獨立資料庫。');process.exitCode=1; }
  finally { await connection?.end(); }
}
