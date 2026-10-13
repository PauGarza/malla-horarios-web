-- =============================================================================
-- Autoplanear — los CHECK que importan, como triggers
--
-- OBLIGATORIO en el servidor del ITAM: MariaDB 5.5.68 (confirmado 2026-09-25)
-- parsea los CHECK de schema-mysql.sql y los IGNORA en silencio: no da error,
-- no da warning, simplemente nunca rechazan nada. El CHECK de verdad llego en
-- MariaDB 10.2 / MySQL 8.0.16; si algun dia este esquema corre en algo mas
-- nuevo, este archivo sobra y cargarlo duplicaria validaciones.
--
-- El esquema tiene 11 CHECK. Aqui se cubren solo los 3 que protegen datos que
-- entran por una pantalla (formulario del profesor, catalogo, ajuste de
-- jefatura); los otros 8 son invariantes que la
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

-- 2026-10-12: el numero de cursos que ajusta la jefatura en "Respuestas y
-- bloqueos" (respuestas.php lo valida tambien). Entra por una pantalla, no es
-- un invariante interno, asi que va con trigger como el del profesor.
CREATE TRIGGER trg_anc_cursos_ins BEFORE INSERT ON ajuste_num_cursos FOR EACH ROW
BEGIN
    IF NEW.num_cursos < 0 OR NEW.num_cursos > 6 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'num_cursos debe estar entre 0 y 6';
    END IF;
END$$

CREATE TRIGGER trg_anc_cursos_upd BEFORE UPDATE ON ajuste_num_cursos FOR EACH ROW
BEGIN
    IF NEW.num_cursos < 0 OR NEW.num_cursos > 6 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'num_cursos debe estar entre 0 y 6';
    END IF;
END$$

DELIMITER ;
