-- =============================================================================
-- Autoplanear — los CHECK que importan, como triggers
--
-- OBLIGATORIO en el servidor del ITAM: MariaDB 5.5.68 (confirmado 2026-09-25)
-- parsea los CHECK de schema-mysql.sql y los IGNORA en silencio: no da error,
-- no da warning, simplemente nunca rechazan nada. El CHECK de verdad llego en
-- MariaDB 10.2 / MySQL 8.0.16; si algun dia este esquema corre en algo mas
-- nuevo, este archivo sobra y cargarlo duplicaria validaciones.
--
-- El esquema tiene 10 CHECK. Aqui se cubren solo los 2 que protegen datos que
-- entran desde el formulario del profesor; los otros 8 son invariantes que la
-- aplicacion nunca viola por si sola (materia_id <> prerequisito_id y
-- parientes) y se validan en PHP. Es una decision, no un olvido: MySQL no
-- tiene "BEFORE INSERT OR UPDATE", asi que cada regla cuesta DOS triggers, y
-- no vale duplicar 20 triggers por invariantes que ningun endpoint puede
-- romper.
-- =============================================================================

DELIMITER $$

CREATE TRIGGER trg_pref_cursos_ins BEFORE INSERT ON preferencia FOR EACH ROW
BEGIN
    IF NEW.num_cursos_max < 1 OR NEW.num_cursos_max > 6 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'num_cursos_max debe estar entre 1 y 6';
    END IF;
END$$

CREATE TRIGGER trg_pref_cursos_upd BEFORE UPDATE ON preferencia FOR EACH ROW
BEGIN
    IF NEW.num_cursos_max < 1 OR NEW.num_cursos_max > 6 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'num_cursos_max debe estar entre 1 y 6';
    END IF;
END$$

CREATE TRIGGER trg_materia_creditos_ins BEFORE INSERT ON materia FOR EACH ROW
BEGIN
    IF NEW.creditos <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'creditos debe ser mayor que 0';
    END IF;
END$$

CREATE TRIGGER trg_materia_creditos_upd BEFORE UPDATE ON materia FOR EACH ROW
BEGIN
    IF NEW.creditos <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'creditos debe ser mayor que 0';
    END IF;
END$$

DELIMITER ;
