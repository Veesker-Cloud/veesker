-- =============================================================
--  Oracle HR Sample Schema
--  Veesker – usability validation for Phase 4b/4c features
-- =============================================================

-- ── Clean up (safe to re-run) ─────────────────────────────────
BEGIN
  FOR t IN (
    SELECT object_name, object_type FROM user_objects
    WHERE object_name IN (
      'EMPLOYEES','DEPARTMENTS','JOBS','JOB_HISTORY',
      'LOCATIONS','COUNTRIES','REGIONS',
      'EMPLOYEES_SEQ','DEPARTMENTS_SEQ','LOCATIONS_SEQ',
      'EMP_DETAILS_VIEW',
      'GET_EMPLOYEE','ADD_JOB_HISTORY','HR_PKG',
      'UPDATE_JOB_HISTORY_TRG','SECURE_EMPLOYEES_TRG'
    )
    ORDER BY DECODE(object_type,'TRIGGER',1,'PROCEDURE',2,'FUNCTION',3,
                    'PACKAGE BODY',4,'PACKAGE',5,'VIEW',6,'TABLE',7,'SEQUENCE',8,9)
  ) LOOP
    BEGIN
      EXECUTE IMMEDIATE 'DROP '||t.object_type||' "'||t.object_name||'"'
        || CASE WHEN t.object_type='TABLE' THEN ' CASCADE CONSTRAINTS' ELSE '' END;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END;
/

-- ── REGIONS ───────────────────────────────────────────────────
CREATE TABLE regions (
  region_id   NUMBER        CONSTRAINT regions_pk PRIMARY KEY,
  region_name VARCHAR2(25)
);

INSERT INTO regions VALUES (1, 'Europe');
INSERT INTO regions VALUES (2, 'Americas');
INSERT INTO regions VALUES (3, 'Asia');
INSERT INTO regions VALUES (4, 'Middle East and Africa');

-- ── COUNTRIES ─────────────────────────────────────────────────
CREATE TABLE countries (
  country_id   CHAR(2)      CONSTRAINT countries_pk PRIMARY KEY,
  country_name VARCHAR2(40),
  region_id    NUMBER
    CONSTRAINT countries_regions_fk REFERENCES regions(region_id)
);

INSERT INTO countries VALUES ('AR','Argentina',       2);
INSERT INTO countries VALUES ('AU','Australia',       3);
INSERT INTO countries VALUES ('BE','Belgium',         1);
INSERT INTO countries VALUES ('BR','Brazil',          2);
INSERT INTO countries VALUES ('CA','Canada',          2);
INSERT INTO countries VALUES ('CN','China',           3);
INSERT INTO countries VALUES ('DE','Germany',         1);
INSERT INTO countries VALUES ('EG','Egypt',           4);
INSERT INTO countries VALUES ('FR','France',          1);
INSERT INTO countries VALUES ('GB','United Kingdom',  1);
INSERT INTO countries VALUES ('IL','Israel',          4);
INSERT INTO countries VALUES ('IN','India',           3);
INSERT INTO countries VALUES ('IT','Italy',           1);
INSERT INTO countries VALUES ('JP','Japan',           3);
INSERT INTO countries VALUES ('KW','Kuwait',          4);
INSERT INTO countries VALUES ('MX','Mexico',          2);
INSERT INTO countries VALUES ('NG','Nigeria',         4);
INSERT INTO countries VALUES ('NL','Netherlands',     1);
INSERT INTO countries VALUES ('SG','Singapore',       3);
INSERT INTO countries VALUES ('US','United States',   2);
INSERT INTO countries VALUES ('ZM','Zambia',          4);
INSERT INTO countries VALUES ('ZW','Zimbabwe',        4);

-- ── LOCATIONS ─────────────────────────────────────────────────
CREATE SEQUENCE locations_seq START WITH 1000 INCREMENT BY 100;

CREATE TABLE locations (
  location_id    NUMBER(4)    CONSTRAINT locations_pk PRIMARY KEY,
  street_address VARCHAR2(40),
  postal_code    VARCHAR2(12),
  city           VARCHAR2(30) NOT NULL,
  state_province VARCHAR2(25),
  country_id     CHAR(2)
    CONSTRAINT locations_countries_fk REFERENCES countries(country_id)
);

INSERT INTO locations VALUES (1000,'1297 Via Cola di Rie','00989','Roma',        NULL, 'IT');
INSERT INTO locations VALUES (1100,'93091 Calle della Testa','10934','Venice',   NULL, 'IT');
INSERT INTO locations VALUES (1200,'2017 Shinjuku-ku',       '1689','Tokyo',     'Tokyo Prefecture','JP');
INSERT INTO locations VALUES (1300,'9450 Kamiya-cho',        '6823','Hiroshima', NULL,'JP');
INSERT INTO locations VALUES (1400,'2014 Jabberwocky Rd',   '26192','Southlake', 'Texas','US');
INSERT INTO locations VALUES (1500,'2011 Interiors Blvd',   '99236','South San Francisco','California','US');
INSERT INTO locations VALUES (1600,'2007 Zagora St',        '50090','South Brunswick','New Jersey','US');
INSERT INTO locations VALUES (1700,'2004 Charade Rd',       '98199','Seattle',   'Washington','US');
INSERT INTO locations VALUES (1800,'147 Spadina Ave',       'M5V 2L7','Toronto', 'Ontario','CA');
INSERT INTO locations VALUES (1900,'6092 Boxwood St',       'YSW 9T2','Whitehorse','Yukon','CA');
INSERT INTO locations VALUES (2000,'40-5-12 Laogianggen',   '190518','Beijing',  NULL,'CN');
INSERT INTO locations VALUES (2100,'1298 Vileparle (E)',    '490231','Bombay',   'Maharashtra','IN');
INSERT INTO locations VALUES (2200,'12-98 Victoria Street', '2901',  'Sydney',   'New South Wales','AU');
INSERT INTO locations VALUES (2300,'198 Clementi North',    '540198','Singapore', NULL,'SG');
INSERT INTO locations VALUES (2400,'8204 Arthur St',        NULL,    'London',   NULL,'GB');
INSERT INTO locations VALUES (2500,'Magdalen Centre, Oxford Science Park','OX9 9ZB','Oxford','Oxford','GB');
INSERT INTO locations VALUES (2600,'9702 Chester Road',     '09629850293','Stretford','Manchester','GB');
INSERT INTO locations VALUES (2700,'Schwanthalerstr. 7031', '80925','Munich',    'Bavaria','DE');
INSERT INTO locations VALUES (2800,'Rua Frei Caneca 1360',  '01307-002','Sao Paulo','Sao Paulo','BR');
INSERT INTO locations VALUES (2900,'20 Rue des Corps-Saints','1730','Geneva',    'Geneve','FR');
INSERT INTO locations VALUES (3000,'Murtenstrasse 921',     '3095','Bern',       'BE','DE');
INSERT INTO locations VALUES (3100,'Pieter Breughelstraat 837','3029SK','Utrecht', NULL,'NL');
INSERT INTO locations VALUES (3200,'Mariano Escobedo 9991', '11932','Mexico City','Distrito Federal','MX');

-- ── JOBS ──────────────────────────────────────────────────────
CREATE TABLE jobs (
  job_id     VARCHAR2(10)  CONSTRAINT jobs_pk PRIMARY KEY,
  job_title  VARCHAR2(35)  NOT NULL,
  min_salary NUMBER(6),
  max_salary NUMBER(6)
);

INSERT INTO jobs VALUES ('AD_PRES',  'President',                    20000, 40000);
INSERT INTO jobs VALUES ('AD_VP',    'Administration Vice President', 15000, 30000);
INSERT INTO jobs VALUES ('AD_ASST',  'Administration Assistant',      3000,  6000);
INSERT INTO jobs VALUES ('FI_MGR',   'Finance Manager',              8200,  16000);
INSERT INTO jobs VALUES ('FI_ACCOUNT','Accountant',                  4200,   9000);
INSERT INTO jobs VALUES ('AC_MGR',   'Accounting Manager',           8200,  16000);
INSERT INTO jobs VALUES ('AC_ACCOUNT','Public Accountant',           4200,   9000);
INSERT INTO jobs VALUES ('SA_MAN',   'Sales Manager',                10000, 20000);
INSERT INTO jobs VALUES ('SA_REP',   'Sales Representative',         6000,  12000);
INSERT INTO jobs VALUES ('PU_MAN',   'Purchasing Manager',           8000,  15000);
INSERT INTO jobs VALUES ('PU_CLERK', 'Purchasing Clerk',             2500,   5500);
INSERT INTO jobs VALUES ('ST_MAN',   'Stock Manager',                5500,   8500);
INSERT INTO jobs VALUES ('ST_CLERK', 'Stock Clerk',                  2000,   5000);
INSERT INTO jobs VALUES ('SH_CLERK', 'Shipping Clerk',               2500,   5500);
INSERT INTO jobs VALUES ('IT_PROG',  'Programmer',                   4000,  10000);
INSERT INTO jobs VALUES ('MK_MAN',   'Marketing Manager',            9000,  15000);
INSERT INTO jobs VALUES ('MK_REP',   'Marketing Representative',     4000,   9000);
INSERT INTO jobs VALUES ('HR_REP',   'Human Resources Representative',4000,  9000);
INSERT INTO jobs VALUES ('PR_REP',   'Public Relations Representative',4500,10500);

-- ── DEPARTMENTS ───────────────────────────────────────────────
CREATE SEQUENCE departments_seq START WITH 280 INCREMENT BY 10;

CREATE TABLE departments (
  department_id   NUMBER(4)    CONSTRAINT departments_pk PRIMARY KEY,
  department_name VARCHAR2(30) NOT NULL,
  manager_id      NUMBER(6),
  location_id     NUMBER(4)
    CONSTRAINT departments_locations_fk REFERENCES locations(location_id)
);

INSERT INTO departments VALUES (10,  'Administration',    200, 1700);
INSERT INTO departments VALUES (20,  'Marketing',         201, 1800);
INSERT INTO departments VALUES (30,  'Purchasing',        114, 1700);
INSERT INTO departments VALUES (40,  'Human Resources',   203, 2400);
INSERT INTO departments VALUES (50,  'Shipping',          121, 1500);
INSERT INTO departments VALUES (60,  'IT',                103, 1400);
INSERT INTO departments VALUES (70,  'Public Relations',  204, 2700);
INSERT INTO departments VALUES (80,  'Sales',             145, 2500);
INSERT INTO departments VALUES (90,  'Executive',         100, 1700);
INSERT INTO departments VALUES (100, 'Finance',           108, 1700);
INSERT INTO departments VALUES (110, 'Accounting',        205, 1700);
INSERT INTO departments VALUES (120, 'Treasury',          NULL,1700);
INSERT INTO departments VALUES (130, 'Corporate Tax',     NULL,1700);
INSERT INTO departments VALUES (140, 'Control And Credit',NULL,1700);
INSERT INTO departments VALUES (150, 'Shareholder Services',NULL,1700);
INSERT INTO departments VALUES (160, 'Benefits',          NULL,1700);
INSERT INTO departments VALUES (170, 'Manufacturing',     NULL,1700);
INSERT INTO departments VALUES (180, 'Construction',      NULL,1700);
INSERT INTO departments VALUES (190, 'Contracting',       NULL,1700);
INSERT INTO departments VALUES (200, 'Operations',        NULL,1700);
INSERT INTO departments VALUES (210, 'IT Support',        NULL,1700);
INSERT INTO departments VALUES (220, 'NOC',               NULL,1700);
INSERT INTO departments VALUES (230, 'IT Helpdesk',       NULL,1700);
INSERT INTO departments VALUES (240, 'Government Sales',  NULL,1700);
INSERT INTO departments VALUES (250, 'Retail Sales',      NULL,1700);
INSERT INTO departments VALUES (260, 'Recruiting',        NULL,1700);
INSERT INTO departments VALUES (270, 'Payroll',           NULL,1700);

-- ── EMPLOYEES ─────────────────────────────────────────────────
CREATE SEQUENCE employees_seq START WITH 207 INCREMENT BY 1;

CREATE TABLE employees (
  employee_id    NUMBER(6)     CONSTRAINT employees_pk PRIMARY KEY,
  first_name     VARCHAR2(20),
  last_name      VARCHAR2(25)  NOT NULL,
  email          VARCHAR2(25)  NOT NULL CONSTRAINT employees_email_uk UNIQUE,
  phone_number   VARCHAR2(20),
  hire_date      DATE          NOT NULL,
  job_id         VARCHAR2(10)  NOT NULL
    CONSTRAINT employees_jobs_fk REFERENCES jobs(job_id),
  salary         NUMBER(8,2),
  commission_pct NUMBER(2,2),
  manager_id     NUMBER(6)
    CONSTRAINT employees_manager_fk REFERENCES employees(employee_id),
  department_id  NUMBER(4)
    CONSTRAINT employees_departments_fk REFERENCES departments(department_id)
);

INSERT INTO employees VALUES (100,'Steven',   'King',     'SKING',    '515.123.4567', DATE'1987-06-17','AD_PRES', 24000,NULL,NULL, 90);
INSERT INTO employees VALUES (101,'Neena',    'Kochhar',  'NKOCHHAR', '515.123.4568', DATE'1989-09-21','AD_VP',   17000,NULL, 100, 90);
INSERT INTO employees VALUES (102,'Lex',      'De Haan',  'LDEHAAN',  '515.123.4569', DATE'1993-01-13','AD_VP',   17000,NULL, 100, 90);
INSERT INTO employees VALUES (103,'Alexander','Hunold',   'AHUNOLD',  '590.423.4567', DATE'1990-01-03','IT_PROG',  9000,NULL, 102, 60);
INSERT INTO employees VALUES (104,'Bruce',    'Ernst',    'BERNST',   '590.423.4568', DATE'1991-05-21','IT_PROG',  6000,NULL, 103, 60);
INSERT INTO employees VALUES (105,'David',    'Austin',   'DAUSTIN',  '590.423.4569', DATE'1997-06-25','IT_PROG',  4800,NULL, 103, 60);
INSERT INTO employees VALUES (106,'Valli',    'Pataballa','VPATABAL', '590.423.4560', DATE'1998-02-05','IT_PROG',  4800,NULL, 103, 60);
INSERT INTO employees VALUES (107,'Diana',    'Lorentz',  'DLORENTZ', '590.423.5567', DATE'1999-02-07','IT_PROG',  4200,NULL, 103, 60);
INSERT INTO employees VALUES (108,'Nancy',    'Greenberg','NGREENBE', '515.124.4569', DATE'1994-08-17','FI_MGR',  12000,NULL, 101,100);
INSERT INTO employees VALUES (109,'Daniel',   'Faviet',   'DFAVIET',  '515.124.4169', DATE'1994-08-16','FI_ACCOUNT',9000,NULL,108,100);
INSERT INTO employees VALUES (110,'John',     'Chen',     'JCHEN',    '515.124.4269', DATE'1997-09-28','FI_ACCOUNT',8200,NULL,108,100);
INSERT INTO employees VALUES (111,'Ismael',   'Sciarra',  'ISCIARRA', '515.124.4369', DATE'1997-09-30','FI_ACCOUNT',7700,NULL,108,100);
INSERT INTO employees VALUES (112,'Jose Manuel','Urman',  'JMURMAN',  '515.124.4469', DATE'1998-03-07','FI_ACCOUNT',7800,NULL,108,100);
INSERT INTO employees VALUES (113,'Luis',     'Popp',     'LPOPP',    '515.124.4567', DATE'1999-12-07','FI_ACCOUNT',6900,NULL,108,100);
INSERT INTO employees VALUES (114,'Den',      'Raphaely', 'DRAPHEAL', '515.127.4561', DATE'1994-12-07','PU_MAN',  11000,NULL, 100, 30);
INSERT INTO employees VALUES (115,'Alexander','Khoo',     'AKHOO',    '515.127.4562', DATE'1995-05-18','PU_CLERK', 3100,NULL, 114, 30);
INSERT INTO employees VALUES (116,'Shelli',   'Baida',    'SBAIDA',   '515.127.4563', DATE'1997-12-24','PU_CLERK', 2900,NULL, 114, 30);
INSERT INTO employees VALUES (117,'Sigal',    'Tobias',   'STOBIAS',  '515.127.4564', DATE'1997-07-24','PU_CLERK', 2800,NULL, 114, 30);
INSERT INTO employees VALUES (118,'Guy',      'Himuro',   'GHIMURO',  '515.127.4565', DATE'1998-11-15','PU_CLERK', 2600,NULL, 114, 30);
INSERT INTO employees VALUES (119,'Karen',    'Colmenares','KCOLMENA','515.127.4566', DATE'1999-08-10','PU_CLERK', 2500,NULL, 114, 30);
INSERT INTO employees VALUES (120,'Matthew',  'Weiss',    'MWEISS',   '650.123.1234', DATE'1996-07-18','ST_MAN',   8000,NULL, 100, 50);
INSERT INTO employees VALUES (121,'Adam',     'Fripp',    'AFRIPP',   '650.123.2234', DATE'1997-04-10','ST_MAN',   8200,NULL, 100, 50);
INSERT INTO employees VALUES (122,'Payam',    'Kaufling', 'PKAUFLIN', '650.123.3234', DATE'1995-05-01','ST_MAN',   7900,NULL, 100, 50);
INSERT INTO employees VALUES (123,'Shanta',   'Vollman',  'SVOLLMAN', '650.123.4234', DATE'1997-10-10','ST_MAN',   6500,NULL, 100, 50);
INSERT INTO employees VALUES (124,'Kevin',    'Mourgos',  'KMOURGOS', '650.123.5234', DATE'1999-11-16','ST_MAN',   5800,NULL, 100, 50);
INSERT INTO employees VALUES (125,'Julia',    'Nayer',    'JNAYER',   '650.124.1214', DATE'1997-07-16','ST_CLERK', 3200,NULL, 120, 50);
INSERT INTO employees VALUES (126,'Irene',    'Mikkileni','IMIKKILE', '650.124.1224', DATE'1998-09-28','ST_CLERK', 2700,NULL, 120, 50);
INSERT INTO employees VALUES (127,'James',    'Landry',   'JLANDRY',  '650.124.1334', DATE'1999-01-14','ST_CLERK', 2400,NULL, 120, 50);
INSERT INTO employees VALUES (128,'Steven',   'Marle',    'SMARLE',   '650.124.1434', DATE'2000-02-23','ST_CLERK', 2200,NULL, 120, 50);
INSERT INTO employees VALUES (129,'Laura',    'Bissot',   'LBISSOT',  '650.124.5234', DATE'1997-08-20','ST_CLERK', 3300,NULL, 121, 50);
INSERT INTO employees VALUES (130,'Mozhe',    'Atkinson', 'MATKINSO', '650.124.6234', DATE'1997-10-30','ST_CLERK', 2800,NULL, 121, 50);
INSERT INTO employees VALUES (131,'James',    'Marlow',   'JAMRLOW',  '650.124.7234', DATE'1997-02-16','ST_CLERK', 2500,NULL, 121, 50);
INSERT INTO employees VALUES (132,'TJ',       'Olson',    'TJOLSON',  '650.124.8234', DATE'1999-04-10','ST_CLERK', 2100,NULL, 121, 50);
INSERT INTO employees VALUES (133,'Jason',    'Mallin',   'JMALLIN',  '650.127.1934', DATE'1996-06-14','ST_CLERK', 3300,NULL, 122, 50);
INSERT INTO employees VALUES (134,'Michael',  'Rogers',   'MROGERS',  '650.127.1834', DATE'1998-08-26','ST_CLERK', 2900,NULL, 122, 50);
INSERT INTO employees VALUES (135,'Ki',       'Gee',      'KGEE',     '650.127.1734', DATE'1999-12-12','ST_CLERK', 2400,NULL, 122, 50);
INSERT INTO employees VALUES (136,'Hazel',    'Philtanker','HPHILTAN','650.127.1634', DATE'2000-02-06','ST_CLERK', 2200,NULL, 122, 50);
INSERT INTO employees VALUES (137,'Renske',   'Ladwig',   'RLADWIG',  '650.121.1234', DATE'1995-07-14','ST_CLERK', 3600,NULL, 123, 50);
INSERT INTO employees VALUES (138,'Stephen',  'Stiles',   'SSTILES',  '650.121.2034', DATE'1997-10-26','ST_CLERK', 3200,NULL, 123, 50);
INSERT INTO employees VALUES (139,'John',     'Seo',      'JSEO',     '650.121.2019', DATE'1998-02-12','ST_CLERK', 2700,NULL, 123, 50);
INSERT INTO employees VALUES (140,'Joshua',   'Patel',    'JPATEL',   '650.121.1834', DATE'1998-04-06','ST_CLERK', 2500,NULL, 123, 50);
INSERT INTO employees VALUES (141,'Trenna',   'Rajs',     'TRAJS',    '650.121.8009', DATE'1995-10-17','ST_CLERK', 3500,NULL, 124, 50);
INSERT INTO employees VALUES (142,'Curtis',   'Davies',   'CDAVIES',  '650.121.2994', DATE'1997-01-29','ST_CLERK', 3100,NULL, 124, 50);
INSERT INTO employees VALUES (143,'Randall',  'Matos',    'RMATOS',   '650.121.2874', DATE'1998-03-15','ST_CLERK', 2600,NULL, 124, 50);
INSERT INTO employees VALUES (144,'Peter',    'Vargas',   'PVARGAS',  '650.121.2004', DATE'1998-07-09','ST_CLERK', 2500,NULL, 124, 50);
INSERT INTO employees VALUES (145,'John',     'Russell',  'JRUSSEL',  '011.44.1344.429268',DATE'1996-10-01','SA_MAN',14000,0.4, 100, 80);
INSERT INTO employees VALUES (146,'Karen',    'Partners', 'KPARTNER', '011.44.1344.467268',DATE'1997-01-05','SA_MAN',13500,0.3, 100, 80);
INSERT INTO employees VALUES (147,'Alberto',  'Errazuriz','AERRAZUR', '011.44.1344.429278',DATE'1997-03-10','SA_MAN',12000,0.3, 100, 80);
INSERT INTO employees VALUES (148,'Gerald',   'Cambrault','GCAMBRAU', '011.44.1344.619268',DATE'1999-10-15','SA_MAN',11000,0.3, 100, 80);
INSERT INTO employees VALUES (149,'Eleni',    'Zlotkey',  'EZLOTKEY', '011.44.1344.429018',DATE'2000-01-29','SA_MAN',10500,0.2, 100, 80);
INSERT INTO employees VALUES (150,'Peter',    'Tucker',   'PTUCKER',  '011.44.1344.129268',DATE'1997-01-30','SA_REP', 10000,0.3, 145, 80);
INSERT INTO employees VALUES (174,'Ellen',    'Abel',     'EABEL',    '011.44.1644.429267',DATE'1996-05-11','SA_REP', 11000,0.3, 149, 80);
INSERT INTO employees VALUES (176,'Jonathon', 'Taylor',   'JTAYLOR',  '011.44.1644.429265',DATE'1998-03-24','SA_REP',  8600,0.2, 149, 80);
INSERT INTO employees VALUES (177,'Jack',     'Livingston','JLIVINGS','011.44.1644.429264',DATE'1998-04-23','SA_REP',  8400,0.2, 149, 80);
INSERT INTO employees VALUES (178,'Kimberely','Grant',    'KGRANT',   '011.44.1644.429263',DATE'1999-05-24','SA_REP',  7000,0.15,149, NULL);
INSERT INTO employees VALUES (179,'Charles',  'Johnson',  'CJOHNSON', '011.44.1644.429262',DATE'2000-01-04','SA_REP',  6200,0.1, 149, 80);
INSERT INTO employees VALUES (200,'Jennifer', 'Whalen',   'JWHALEN',  '515.123.4444',DATE'1987-09-17','AD_ASST', 4400,NULL, 101, 10);
INSERT INTO employees VALUES (201,'Michael',  'Hartstein','MHARTSTE', '515.123.5555',DATE'1996-02-17','MK_MAN',  13000,NULL, 100, 20);
INSERT INTO employees VALUES (202,'Pat',      'Fay',      'PFAY',     '603.123.6666',DATE'1997-08-17','MK_REP',   6000,NULL, 201, 20);
INSERT INTO employees VALUES (203,'Susan',    'Mavris',   'SMAVRIS',  '515.123.7777',DATE'1994-06-07','HR_REP',   6500,NULL, 101, 40);
INSERT INTO employees VALUES (204,'Hermann',  'Baer',     'HBAER',    '515.123.8888',DATE'1994-06-07','PR_REP',  10000,NULL, 101, 70);
INSERT INTO employees VALUES (205,'Shelley',  'Higgins',  'SHIGGINS', '515.123.8080',DATE'1994-06-07','AC_MGR',  12000,NULL, 101,110);
INSERT INTO employees VALUES (206,'William',  'Gietz',    'WGIETZ',   '515.123.8181',DATE'1994-06-07','AC_ACCOUNT',8300,NULL,205,110);

-- ── JOB_HISTORY ───────────────────────────────────────────────
CREATE TABLE job_history (
  employee_id   NUMBER(6)    NOT NULL,
  start_date    DATE         NOT NULL,
  end_date      DATE         NOT NULL,
  job_id        VARCHAR2(10) NOT NULL
    CONSTRAINT jhist_jobs_fk REFERENCES jobs(job_id),
  department_id NUMBER(4)
    CONSTRAINT jhist_departments_fk REFERENCES departments(department_id),
  CONSTRAINT jhist_pk PRIMARY KEY (employee_id, start_date),
  CONSTRAINT jhist_emp_fk FOREIGN KEY (employee_id) REFERENCES employees(employee_id),
  CONSTRAINT jhist_date_interval CHECK (end_date > start_date)
);

INSERT INTO job_history VALUES (102, DATE'1993-01-13', DATE'1998-07-24', 'IT_PROG',   60);
INSERT INTO job_history VALUES (101, DATE'1989-09-21', DATE'1993-10-27', 'AC_ACCOUNT',110);
INSERT INTO job_history VALUES (101, DATE'1993-10-28', DATE'1997-03-15', 'AC_MGR',    110);
INSERT INTO job_history VALUES (201, DATE'1996-02-17', DATE'1999-12-19', 'MK_REP',    20);
INSERT INTO job_history VALUES (114, DATE'1998-03-24', DATE'1999-12-31', 'ST_CLERK',  50);
INSERT INTO job_history VALUES (122, DATE'1999-01-01', DATE'1999-12-31', 'ST_CLERK',  50);
INSERT INTO job_history VALUES (200, DATE'1987-09-17', DATE'1993-06-17', 'AD_ASST',   90);
INSERT INTO job_history VALUES (176, DATE'1998-03-24', DATE'1998-12-31', 'SA_REP',    80);
INSERT INTO job_history VALUES (176, DATE'1999-01-01', DATE'1999-12-31', 'SA_MAN',    80);
INSERT INTO job_history VALUES (200, DATE'1994-07-01', DATE'1998-12-31', 'AC_ACCOUNT',90);

-- ── FOREIGN KEY: departments.manager_id → employees ───────────
ALTER TABLE departments ADD CONSTRAINT dept_mgr_fk
  FOREIGN KEY (manager_id) REFERENCES employees(employee_id);

-- ── INDEXES ───────────────────────────────────────────────────
CREATE INDEX emp_department_ix  ON employees(department_id);
CREATE INDEX emp_job_ix         ON employees(job_id);
CREATE INDEX emp_manager_ix     ON employees(manager_id);
CREATE INDEX emp_name_ix        ON employees(last_name, first_name);
CREATE INDEX dept_location_ix   ON departments(location_id);
CREATE INDEX jhist_job_ix       ON job_history(job_id);
CREATE INDEX jhist_employee_ix  ON job_history(employee_id);
CREATE INDEX jhist_department_ix ON job_history(department_id);

-- ── VIEW ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW emp_details_view AS
  SELECT
    e.employee_id,
    e.job_id,
    e.manager_id,
    e.department_id,
    d.location_id,
    l.country_id,
    e.first_name,
    e.last_name,
    e.salary,
    e.commission_pct,
    d.department_name,
    j.job_title,
    l.city,
    l.state_province,
    c.country_name,
    r.region_name
  FROM employees e
  JOIN departments d ON e.department_id = d.department_id
  JOIN jobs j        ON e.job_id        = j.job_id
  JOIN locations l   ON d.location_id   = l.location_id
  JOIN countries c   ON l.country_id    = c.country_id
  JOIN regions r     ON c.region_id     = r.region_id;

-- ── FUNCTION: get_employee ─────────────────────────────────────
CREATE OR REPLACE FUNCTION get_employee (
  p_id IN employees.employee_id%TYPE
) RETURN employees%ROWTYPE AS
  v_emp employees%ROWTYPE;
BEGIN
  SELECT * INTO v_emp FROM employees WHERE employee_id = p_id;
  RETURN v_emp;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE_APPLICATION_ERROR(-20001, 'Employee '||p_id||' not found');
END get_employee;
/

-- ── PROCEDURE: add_job_history ────────────────────────────────
CREATE OR REPLACE PROCEDURE add_job_history (
  p_emp_id     IN job_history.employee_id%TYPE,
  p_start_date IN job_history.start_date%TYPE,
  p_end_date   IN job_history.end_date%TYPE,
  p_job_id     IN job_history.job_id%TYPE,
  p_dept_id    IN job_history.department_id%TYPE
) AS
BEGIN
  INSERT INTO job_history (employee_id, start_date, end_date, job_id, department_id)
  VALUES (p_emp_id, p_start_date, p_end_date, p_job_id, p_dept_id);
  DBMS_OUTPUT.PUT_LINE('Added history for employee '||p_emp_id);
END add_job_history;
/

-- ── PACKAGE: hr_pkg ───────────────────────────────────────────
CREATE OR REPLACE PACKAGE hr_pkg AS
  -- Returns full name for a given employee
  FUNCTION full_name (p_id IN NUMBER) RETURN VARCHAR2;
  -- Returns headcount for a department
  FUNCTION dept_headcount (p_dept_id IN NUMBER) RETURN NUMBER;
  -- Gives a raise (pct is 0..1)
  PROCEDURE give_raise (p_id IN NUMBER, p_pct IN NUMBER);
END hr_pkg;
/

CREATE OR REPLACE PACKAGE BODY hr_pkg AS

  FUNCTION full_name (p_id IN NUMBER) RETURN VARCHAR2 AS
    v_name VARCHAR2(46);
  BEGIN
    SELECT first_name||' '||last_name INTO v_name
    FROM employees WHERE employee_id = p_id;
    RETURN v_name;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN RETURN NULL;
  END full_name;

  FUNCTION dept_headcount (p_dept_id IN NUMBER) RETURN NUMBER AS
    v_cnt NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_cnt FROM employees WHERE department_id = p_dept_id;
    RETURN v_cnt;
  END dept_headcount;

  PROCEDURE give_raise (p_id IN NUMBER, p_pct IN NUMBER) AS
    v_old employees.salary%TYPE;
    v_new employees.salary%TYPE;
  BEGIN
    SELECT salary INTO v_old FROM employees WHERE employee_id = p_id;
    v_new := ROUND(v_old * (1 + p_pct), 2);
    UPDATE employees SET salary = v_new WHERE employee_id = p_id;
    DBMS_OUTPUT.PUT_LINE(
      'Employee '||p_id||': '||v_old||' → '||v_new||
      ' ('||ROUND(p_pct*100)||'% raise)'
    );
  END give_raise;

END hr_pkg;
/

-- ── TRIGGER: secure_employees (business-hours guard) ─────────
CREATE OR REPLACE TRIGGER secure_employees
  BEFORE INSERT OR UPDATE OR DELETE ON employees
BEGIN
  IF TO_CHAR(SYSDATE,'HH24') NOT BETWEEN '06' AND '22' THEN
    RAISE_APPLICATION_ERROR(
      -20500,
      'Employee table modifications only allowed between 06:00 and 22:00'
    );
  END IF;
END secure_employees;
/

-- ── TRIGGER: update_job_history (auto-log on job change) ──────
CREATE OR REPLACE TRIGGER update_job_history
  AFTER UPDATE OF job_id, department_id ON employees
  FOR EACH ROW
BEGIN
  add_job_history(
    :old.employee_id,
    :old.hire_date,
    SYSDATE,
    :old.job_id,
    :old.department_id
  );
END update_job_history;
/

-- ── Smoke test ────────────────────────────────────────────────
DECLARE
  v_emp  NUMBER;
  v_dept NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_emp  FROM employees;
  SELECT COUNT(*) INTO v_dept FROM departments;
  DBMS_OUTPUT.PUT_LINE('=== HR Schema created ===');
  DBMS_OUTPUT.PUT_LINE('Employees : '  || v_emp);
  DBMS_OUTPUT.PUT_LINE('Departments: ' || v_dept);
  DBMS_OUTPUT.PUT_LINE('Full name 100: '  || hr_pkg.full_name(100));
  DBMS_OUTPUT.PUT_LINE('IT headcount: '  || hr_pkg.dept_headcount(60));
END;
/
